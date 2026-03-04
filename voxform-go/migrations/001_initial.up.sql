-- Voxform initial schema — MySQL / XAMPP

CREATE TABLE IF NOT EXISTS organizations (
    id           VARCHAR(64)  NOT NULL PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    slug         VARCHAR(120) NOT NULL UNIQUE,
    plan         ENUM('FREE','STARTER','PRO','BUSINESS','ENTERPRISE') NOT NULL DEFAULT 'FREE',
    logo_url     VARCHAR(500),
    settings     JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id             VARCHAR(64)  NOT NULL PRIMARY KEY,
    org_id         VARCHAR(64)  NOT NULL,
    role           ENUM('OWNER','ADMIN','SURVEYOR','REVIEWER','VIEWER') NOT NULL DEFAULT 'SURVEYOR',
    name           VARCHAR(200) NOT NULL,
    email          VARCHAR(200) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    avatar_url     VARCHAR(500),
    preferences    JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    verify_token   VARCHAR(255),
    reset_token    VARCHAR(255),
    reset_expiry   DATETIME,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_org   (org_id),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_members (
    id          VARCHAR(64) NOT NULL PRIMARY KEY,
    org_id      VARCHAR(64) NOT NULL,
    user_id     VARCHAR(64) NOT NULL,
    role        ENUM('OWNER','ADMIN','SURVEYOR','REVIEWER','VIEWER') NOT NULL DEFAULT 'SURVEYOR',
    invited_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    joined_at   DATETIME,
    UNIQUE KEY uq_org_user (org_id, user_id),
    INDEX idx_org  (org_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id     VARCHAR(64)  NOT NULL,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    expires_at  DATETIME     NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS surveys (
    id             VARCHAR(64)  NOT NULL PRIMARY KEY,
    org_id         VARCHAR(64)  NOT NULL,
    owner_id       VARCHAR(64)  NOT NULL,
    title          VARCHAR(300) NOT NULL,
    description    TEXT,
    slug           VARCHAR(200) NOT NULL UNIQUE,
    status         ENUM('DRAFT','ACTIVE','PAUSED','CLOSED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    config         JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    qc_standards   JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    quota          INT,
    response_count INT          NOT NULL DEFAULT 0,
    expires_at     DATETIME,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_org    (org_id),
    INDEX idx_owner  (owner_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS survey_versions (
    id          VARCHAR(64) NOT NULL PRIMARY KEY,
    survey_id   VARCHAR(64) NOT NULL,
    version     INT         NOT NULL,
    snapshot    JSON        NOT NULL,
    created_by  VARCHAR(64) NOT NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_survey_ver (survey_id, version),
    INDEX idx_survey (survey_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
    id               VARCHAR(64)  NOT NULL PRIMARY KEY,
    survey_id        VARCHAR(64)  NOT NULL,
    type             VARCHAR(50)  NOT NULL,
    title            VARCHAR(500) NOT NULL,
    description      TEXT,
    required         BOOLEAN      NOT NULL DEFAULT FALSE,
    order_index      INT          NOT NULL DEFAULT 0,
    options          JSON         NOT NULL DEFAULT (JSON_OBJECT()),
    logic            JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    audio_prompt_url VARCHAR(500),
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_survey_order (survey_id, order_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
    id             VARCHAR(64) NOT NULL PRIMARY KEY,
    survey_id      VARCHAR(64) NOT NULL,
    surveyor_id    VARCHAR(64),
    respondent_ref VARCHAR(200),
    status         ENUM('IN_PROGRESS','COMPLETED','ABANDONED','SYNCING') NOT NULL DEFAULT 'IN_PROGRESS',
    sync_source    ENUM('ONLINE','OFFLINE') NOT NULL DEFAULT 'ONLINE',
    started_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at   DATETIME,
    location       JSON,
    device_info    JSON        NOT NULL DEFAULT (JSON_OBJECT()),
    created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_survey   (survey_id),
    INDEX idx_surveyor (surveyor_id),
    INDEX idx_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS responses (
    id                VARCHAR(64)  NOT NULL PRIMARY KEY,
    session_id        VARCHAR(64)  NOT NULL,
    question_id       VARCHAR(64)  NOT NULL,
    type              VARCHAR(50)  NOT NULL,
    text_value        TEXT,
    audio_url         VARCHAR(500),
    audio_wav_url     VARCHAR(500),
    audio_duration_sec DOUBLE,
    qc_result         JSON,
    transcript        JSON,
    extracted_value   JSON,
    confidence_score  DOUBLE,
    status            ENUM('DRAFT','SUBMITTED','PROCESSING','REVIEWED','APPROVED','REJECTED','FLAGGED') NOT NULL DEFAULT 'SUBMITTED',
    reviewed_by       VARCHAR(64),
    reviewed_at       DATETIME,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_session  (session_id),
    INDEX idx_question (question_id),
    INDEX idx_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audio_jobs (
    id               VARCHAR(64)  NOT NULL PRIMARY KEY,
    response_id      VARCHAR(64)  NOT NULL UNIQUE,
    status           ENUM('QUEUED','UPLOADING','QC_PENDING','QC_PASSED','QC_FAILED','TRANSCRIBING','EXTRACTING','COMPLETE','FAILED') NOT NULL DEFAULT 'QUEUED',
    wav_path         VARCHAR(500),
    mp3_path         VARCHAR(500),
    qc_server_result JSON,
    transcript_raw   JSON,
    diarization      JSON,
    extracted_data   JSON,
    provider         VARCHAR(30)  NOT NULL DEFAULT 'GROQ',
    error            TEXT,
    attempt_count    INT          NOT NULL DEFAULT 0,
    processing_ms    INT,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_keys (
    id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    org_id      VARCHAR(64)  NOT NULL,
    name        VARCHAR(100) NOT NULL,
    key_hash    VARCHAR(255) NOT NULL UNIQUE,
    key_prefix  VARCHAR(20)  NOT NULL,
    scopes      JSON         NOT NULL DEFAULT (JSON_ARRAY()),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    last_used_at DATETIME,
    expires_at  DATETIME,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_queue (
    id            VARCHAR(64) NOT NULL PRIMARY KEY,
    device_id     VARCHAR(100) NOT NULL,
    user_id       VARCHAR(64)  NOT NULL,
    survey_id     VARCHAR(64)  NOT NULL,
    payload       JSON         NOT NULL,
    attempt_count INT          NOT NULL DEFAULT 0,
    last_attempt  DATETIME,
    synced_at     DATETIME,
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
    error         TEXT,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
