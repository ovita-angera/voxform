-- Demo seed data
-- Passwords are "voxform123" hashed with bcrypt cost 12

INSERT IGNORE INTO organizations (id, name, slug, plan, settings, created_at, updated_at) VALUES
('org_demo001', 'Nairobi Research Institute', 'nairobi-research-institute-demo', 'PRO',
 '{"defaultAudioFormat":"WAV_16K","timezone":"Africa/Nairobi"}', NOW(), NOW());

-- admin@nri.ac.ke / voxform123
INSERT IGNORE INTO users (id, org_id, role, name, email, password_hash, email_verified, preferences, created_at, updated_at) VALUES
('usr_admin001', 'org_demo001', 'OWNER', 'Jane Mwangi', 'admin@nri.ac.ke',
 '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGGR3hCMWJdNRU/rWiibw.sQBpK',
 TRUE, '{"language":"en","timezone":"Africa/Nairobi"}', NOW(), NOW());

-- surveyor@nri.ac.ke / voxform123
INSERT IGNORE INTO users (id, org_id, role, name, email, password_hash, email_verified, preferences, created_at, updated_at) VALUES
('usr_surv001', 'org_demo001', 'SURVEYOR', 'John Kamau', 'surveyor@nri.ac.ke',
 '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGGR3hCMWJdNRU/rWiibw.sQBpK',
 TRUE, '{"language":"en","timezone":"Africa/Nairobi"}', NOW(), NOW());

INSERT IGNORE INTO org_members (id, org_id, user_id, role, invited_at, joined_at) VALUES
('mbr_001', 'org_demo001', 'usr_admin001', 'OWNER', NOW(), NOW()),
('mbr_002', 'org_demo001', 'usr_surv001', 'SURVEYOR', NOW(), NOW());

INSERT IGNORE INTO surveys (id, org_id, owner_id, title, description, slug, status, config, qc_standards, quota, created_at, updated_at) VALUES
('srv_demo001', 'org_demo001', 'usr_admin001',
 'Household Income & Livelihood Survey',
 'Measures household income sources, food security, and livelihood strategies across rural Kenya.',
 'household-income-livelihood-2024',
 'ACTIVE',
 '{"language":"en","allowBack":true,"showProgress":true}',
 '{"minDurationSec":15,"maxSilenceRatio":0.7,"minSnrDb":10,"requireVoiceActivity":true}',
 200, NOW(), NOW());

INSERT IGNORE INTO questions (id, survey_id, type, title, description, required, order_index, options, created_at, updated_at) VALUES
('q_001', 'srv_demo001', 'SHORT_TEXT', 'Respondent full name',
 'Enter the respondent''s full legal name', TRUE, 0,
 '{"placeholder":"e.g. Jane Akinyi Otieno"}', NOW(), NOW()),

('q_002', 'srv_demo001', 'SINGLE_CHOICE', 'Primary household income source',
 'Select the most applicable option', TRUE, 1,
 '{"choices":[{"id":"a","label":"Farming / Agriculture"},{"id":"b","label":"Formal employment"},{"id":"c","label":"Informal / self-employment"},{"id":"d","label":"Remittances from family"},{"id":"e","label":"Social assistance / grants"}]}',
 NOW(), NOW()),

('q_003', 'srv_demo001', 'AUDIO_CAPTURE',
 'Describe the household''s financial situation over the past 6 months',
 'Speak clearly for at least 30 seconds. Include income changes, major expenses, and coping strategies.',
 TRUE, 2,
 '{"minDurationSec":30,"maxDurationSec":300,"qcEnabled":true}', NOW(), NOW()),

('q_004', 'srv_demo001', 'LIKERT', 'Rate the household''s current food security',
 '', TRUE, 3,
 '{"min":1,"max":5,"minLabel":"Very food insecure","maxLabel":"Very food secure"}', NOW(), NOW()),

('q_005', 'srv_demo001', 'LOCATION', 'Record respondent location',
 'GPS coordinates will be captured automatically', TRUE, 4,
 '{"accuracy":"high"}', NOW(), NOW());
