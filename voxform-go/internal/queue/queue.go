package queue

import (
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/voxform/api/internal/db"
)

// Job is a unit of work.
type Job struct {
	ID         string
	Type       string
	Payload    map[string]any
	Attempts   int
	EnqueuedAt time.Time
}

// Handler processes a job.
type Handler func(job Job) error

// Queue is a goroutine-backed, DB-durable work queue. No Redis needed.
type Queue struct {
	ch       chan Job
	handlers map[string]Handler
	mu       sync.RWMutex
	db       *db.DB
	wg       sync.WaitGroup
	quit     chan struct{}
}

func New(database *db.DB, storagePath, groqKey, anthropicKey string, workers int) *Queue {
	q := &Queue{
		ch:       make(chan Job, 500),
		handlers: make(map[string]Handler),
		db:       database,
		quit:     make(chan struct{}),
	}

	// Register audio processing handler
	proc := newAudioProcessor(database, storagePath, groqKey, anthropicKey)
	q.Register("audio:process", proc.Process)

	// Start worker goroutines
	for i := 0; i < workers; i++ {
		q.wg.Add(1)
		go q.worker(i)
	}
	return q
}

func (q *Queue) Register(jobType string, h Handler) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.handlers[jobType] = h
}

// Enqueue adds a job to the buffered channel. Fire-and-forget from callers.
func (q *Queue) Enqueue(jobType string, payload map[string]any) {
	job := Job{
		ID:         randID(),
		Type:       jobType,
		Payload:    payload,
		Attempts:   0,
		EnqueuedAt: time.Now(),
	}
	select {
	case q.ch <- job:
		log.Debug().Str("type", jobType).Str("id", job.ID).Msg("job enqueued")
	default:
		log.Warn().Str("type", jobType).Msg("queue full — job dropped, will retry on next startup")
	}
}

// Start recovers any QUEUED/UPLOADING jobs from previous runs.
func (q *Queue) Start() {
	rows, err := q.db.Queryx(`SELECT response_id FROM audio_jobs WHERE status IN ('QUEUED','UPLOADING')`)
	if err != nil {
		log.Warn().Err(err).Msg("could not load pending audio jobs")
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var responseID string
		rows.Scan(&responseID)
		q.Enqueue("audio:process", map[string]any{"responseId": responseID})
		count++
	}
	if count > 0 {
		log.Info().Int("count", count).Msg("recovered audio jobs from last run")
	}
}

func (q *Queue) Stop() {
	close(q.quit)
	q.wg.Wait()
	log.Info().Msg("queue workers stopped")
}

func (q *Queue) worker(id int) {
	defer q.wg.Done()
	for {
		select {
		case job := <-q.ch:
			q.run(job)
		case <-q.quit:
			return
		}
	}
}

func (q *Queue) run(job Job) {
	q.mu.RLock()
	h, ok := q.handlers[job.Type]
	q.mu.RUnlock()
	if !ok {
		log.Warn().Str("type", job.Type).Msg("no handler for job type")
		return
	}
	if err := h(job); err != nil {
		job.Attempts++
		log.Error().Err(err).Str("id", job.ID).Int("attempt", job.Attempts).Msg("job failed")
		if job.Attempts < 3 {
			delay := time.Duration(job.Attempts*job.Attempts*5) * time.Second
			go func(j Job, d time.Duration) {
				time.Sleep(d)
				select {
				case q.ch <- j:
				default:
				}
			}(job, delay)
		}
	}
}
