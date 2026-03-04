package queue

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/voxform/api/internal/db"
)

type audioProcessor struct {
	db           *db.DB
	storagePath  string
	groqKey      string
	anthropicKey string
}

func newAudioProcessor(database *db.DB, storagePath, groqKey, anthropicKey string) *audioProcessor {
	return &audioProcessor{db: database, storagePath: storagePath, groqKey: groqKey, anthropicKey: anthropicKey}
}

// Process runs the full audio pipeline for one response.
func (p *audioProcessor) Process(job Job) error {
	responseID, _ := job.Payload["responseId"].(string)
	if responseID == "" {
		return fmt.Errorf("missing responseId in payload")
	}
	start := time.Now()
	log.Info().Str("response", responseID).Msg("audio pipeline started")

	// Load job record
	var audioJob struct {
		ID      string  `db:"id"`
		WavPath *string `db:"wav_path"`
	}
	if err := p.db.Get(&audioJob, `SELECT id, wav_path FROM audio_jobs WHERE response_id = ? LIMIT 1`, responseID); err != nil {
		return fmt.Errorf("load audio job: %w", err)
	}

	p.db.Exec(`UPDATE audio_jobs SET status = 'QC_PASSED', updated_at = NOW() WHERE id = ?`, audioJob.ID)

	// Convert to WAV if needed (WebM → WAV via ffmpeg)
	wavPath := ""
	if audioJob.WavPath != nil {
		wavPath = *audioJob.WavPath
	}
	if wavPath != "" && !strings.HasSuffix(wavPath, ".wav") {
		converted, err := p.convertToWav(wavPath)
		if err != nil {
			log.Warn().Err(err).Msg("ffmpeg not available — proceeding with original file")
			converted = wavPath // best effort
		} else {
			wavPath = converted
			p.db.Exec(`UPDATE audio_jobs SET wav_path = ?, updated_at = NOW() WHERE id = ?`, wavPath, audioJob.ID)
		}
	}

	// Transcription via Groq Whisper (if key is set)
	if p.groqKey != "" && wavPath != "" {
		p.db.Exec(`UPDATE audio_jobs SET status = 'TRANSCRIBING', updated_at = NOW() WHERE id = ?`, audioJob.ID)
		transcript, err := p.transcribeGroq(wavPath)
		if err != nil {
			log.Warn().Err(err).Msg("transcription failed — skipping")
		} else {
			transcriptJSON, _ := json.Marshal(transcript)
			p.db.Exec(`UPDATE audio_jobs SET transcript_raw = ?, updated_at = NOW() WHERE id = ?`, string(transcriptJSON), audioJob.ID)
			p.db.Exec(`UPDATE responses SET transcript = ?, status = 'PROCESSING', updated_at = NOW() WHERE id = ?`, string(transcriptJSON), responseID)

			// Optional: Claude extraction
			if p.anthropicKey != "" {
				p.db.Exec(`UPDATE audio_jobs SET status = 'EXTRACTING', updated_at = NOW() WHERE id = ?`, audioJob.ID)
				extracted, err := p.extractClaude(transcript["text"].(string), responseID)
				if err != nil {
					log.Warn().Err(err).Msg("extraction failed — skipping")
				} else {
					extractedJSON, _ := json.Marshal(extracted)
					confidence, _ := extracted["confidence"].(float64)
					p.db.Exec(`UPDATE responses SET extracted_value = ?, confidence_score = ?, status = 'REVIEWED', updated_at = NOW() WHERE id = ?`,
						string(extractedJSON), confidence, responseID)
					p.db.Exec(`UPDATE audio_jobs SET extracted_data = ?, updated_at = NOW() WHERE id = ?`, string(extractedJSON), audioJob.ID)
				}
			}
		}
	}

	// Done
	processingMs := int(time.Since(start).Milliseconds())
	p.db.Exec(`UPDATE audio_jobs SET status = 'COMPLETE', processing_ms = ?, updated_at = NOW() WHERE id = ?`, processingMs, audioJob.ID)
	p.db.Exec(`UPDATE responses SET status = 'SUBMITTED', updated_at = NOW() WHERE id = ? AND status = 'PROCESSING'`, responseID)

	log.Info().Str("response", responseID).Int("ms", processingMs).Msg("audio pipeline complete")
	return nil
}

// convertToWav uses ffmpeg to convert any audio file to 16kHz mono WAV.
func (p *audioProcessor) convertToWav(inputPath string) (string, error) {
	ext := filepath.Ext(inputPath)
	outputPath := strings.TrimSuffix(inputPath, ext) + ".wav"
	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-ar", "16000",  // 16kHz sample rate
		"-ac", "1",      // mono
		"-sample_fmt", "s16",
		outputPath, "-y",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("ffmpeg: %w — %s", err, stderr.String())
	}
	return outputPath, nil
}

// transcribeGroq sends audio to Groq's Whisper API (free tier, 7200 min/month).
func (p *audioProcessor) transcribeGroq(audioPath string) (map[string]any, error) {
	f, err := os.Open(audioPath)
	if err != nil {
		return nil, fmt.Errorf("open audio: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	// file field
	fw, err := mw.CreateFormFile("file", filepath.Base(audioPath))
	if err != nil { return nil, err }
	io.Copy(fw, f)

	// other fields
	mw.WriteField("model", "whisper-large-v3")
	mw.WriteField("response_format", "verbose_json")
	mw.Close()

	req, _ := http.NewRequest("POST", "https://api.groq.com/openai/v1/audio/transcriptions", &buf)
	req.Header.Set("Authorization", "Bearer "+p.groqKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, fmt.Errorf("groq request: %w", err) }
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("groq %d: %s", resp.StatusCode, string(body))
	}

	var result map[string]any
	json.Unmarshal(body, &result)
	result["provider"] = "groq"
	return result, nil
}

// extractClaude uses Anthropic Claude to extract a structured answer from transcript.
func (p *audioProcessor) extractClaude(transcriptText, responseID string) (map[string]any, error) {
	// Get the question title for context
	var questionTitle string
	p.db.DB.Get(&questionTitle, `
		SELECT q.title FROM questions q
		JOIN responses r ON r.question_id = q.id
		WHERE r.id = ? LIMIT 1
	`, responseID)

	prompt := fmt.Sprintf(`Question: "%s"

Transcript: "%s"

Extract a concise answer from this transcript. Respond ONLY with valid JSON:
{"answer":"...","confidence":0.0,"keyPoints":[]}

Rules: answer should be 1-3 sentences. confidence is 0.0-1.0. keyPoints are brief phrases.`,
		questionTitle, transcriptText)

	reqBody, _ := json.Marshal(map[string]any{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 300,
		"messages": []map[string]any{
			{"role": "user", "content": prompt},
		},
	})

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.anthropicKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var apiResp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	json.Unmarshal(body, &apiResp)

	if len(apiResp.Content) == 0 {
		return nil, fmt.Errorf("empty Claude response")
	}

	text := strings.TrimSpace(apiResp.Content[0].Text)
	// Strip markdown code fences if present
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")

	var result map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &result); err != nil {
		return map[string]any{"answer": text, "confidence": 0.5, "keyPoints": []string{}}, nil
	}
	return result, nil
}
