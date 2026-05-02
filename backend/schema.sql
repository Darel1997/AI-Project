-- RepoInsight AI — Database Schema
-- PostgreSQL 15+
-- This schema is auto-created by SQLAlchemy ORM models at startup,
-- but this file serves as the canonical reference.

-- ═══════════════════════════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255),            -- null for OAuth-only users
    full_name       VARCHAR(255),
    avatar_url      TEXT,

    -- GitHub OAuth
    github_id           INTEGER UNIQUE,
    github_username     VARCHAR(100),
    github_access_token TEXT,                -- encrypted in production

    is_active   BOOLEAN DEFAULT TRUE,
    is_owner    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github_id ON users(github_id);

-- ═══════════════════════════════════════════════════════════════
-- ORGANIZATIONS — multi-tenant workspaces
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    avatar_url  TEXT,
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    plan        VARCHAR(30) NOT NULL DEFAULT 'free',   -- free | pro | team
    seats       INTEGER NOT NULL DEFAULT 1,

    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orgs_slug ON organizations(slug);

-- Join table between users and orgs with role
CREATE TABLE IF NOT EXISTS memberships (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',  -- owner | admin | member

    created_at  TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_user_org UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_org ON memberships(organization_id);

-- Pending invitations (email-based)
CREATE TABLE IF NOT EXISTS invitations (
    id              SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'member',
    invited_by_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    token           VARCHAR(128) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,

    created_at  TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_org_email UNIQUE (organization_id, email)
);

CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);

-- ═══════════════════════════════════════════════════════════════
-- REPOSITORIES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS repositories (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,

    github_repo_id  INTEGER NOT NULL,
    full_name       VARCHAR(255) NOT NULL,   -- "owner/repo"
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    default_branch  VARCHAR(100) DEFAULT 'main',
    language        VARCHAR(100),
    stars           INTEGER DEFAULT 0,
    forks           INTEGER DEFAULT 0,
    open_issues     INTEGER DEFAULT 0,

    -- Indexing state
    is_indexed      BOOLEAN DEFAULT FALSE,
    index_status    VARCHAR(50) DEFAULT 'pending',
    total_files     INTEGER DEFAULT 0,
    indexed_files   INTEGER DEFAULT 0,

    -- Cached analytics
    health_score        FLOAT,
    language_breakdown  JSONB,
    total_commits       INTEGER DEFAULT 0,
    total_contributors  INTEGER DEFAULT 0,
    total_lines         INTEGER DEFAULT 0,

    -- Cached AI artifacts (persist between sessions)
    cached_docs             TEXT,
    cached_docs_at          TIMESTAMPTZ,
    cached_audit            JSONB,
    cached_audit_at         TIMESTAMPTZ,
    cached_security         JSONB,
    cached_security_at      TIMESTAMPTZ,
    cached_onboarding       TEXT,
    cached_onboarding_at    TIMESTAMPTZ,
    cached_architecture     TEXT,
    cached_architecture_at  TIMESTAMPTZ,

    -- Webhook integration — auto re-index on GitHub push
    webhook_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_secret              VARCHAR(128),
    webhook_last_triggered_at   TIMESTAMPTZ,
    webhook_last_delivery_id    VARCHAR(64),
    webhook_reindex_count       INTEGER DEFAULT 0,

    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_repos_user_id ON repositories(user_id);

-- ═══════════════════════════════════════════════════════════════
-- REPO FILES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS repo_files (
    id              SERIAL PRIMARY KEY,
    repository_id   INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,

    path        VARCHAR(1000) NOT NULL,
    filename    VARCHAR(255) NOT NULL,
    language    VARCHAR(100),
    size_bytes  INTEGER DEFAULT 0,
    line_count  INTEGER DEFAULT 0,
    content     TEXT,
    sha         VARCHAR(64),

    is_embedded BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_repo_files_repo_id ON repo_files(repository_id);

-- ═══════════════════════════════════════════════════════════════
-- CHAT MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repository_id   INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,

    role        VARCHAR(20) NOT NULL,    -- 'user' or 'assistant'
    content     TEXT NOT NULL,
    sources     JSONB,                   -- cited file paths

    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_user_repo ON chat_messages(user_id, repository_id);

-- ═══════════════════════════════════════════════════════════════
-- TASKS (AI-generated engineering tickets)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tasks (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repository_id   INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,

    title           VARCHAR(500) NOT NULL,
    description     TEXT NOT NULL,
    priority        VARCHAR(20) NOT NULL,    -- critical | high | medium | low
    difficulty      VARCHAR(20) NOT NULL,    -- easy | medium | hard | complex
    task_type       VARCHAR(50) NOT NULL,    -- bug | feature | refactor | docs | test
    suggested_files JSONB,
    status          VARCHAR(20) DEFAULT 'open',

    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_repo ON tasks(user_id, repository_id);

-- ─────────────────────────────────────────────────────────────
-- Subscriptions — Stripe billing state
-- Stored as VARCHAR rather than Postgres ENUM to stay compatible
-- with SQLAlchemy's Base.metadata.create_all() on fresh boots.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id                        SERIAL PRIMARY KEY,
    user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier                      VARCHAR(32) NOT NULL DEFAULT 'free',
    status                    VARCHAR(32) NOT NULL DEFAULT 'active',
    stripe_customer_id        VARCHAR(100) UNIQUE,
    stripe_subscription_id    VARCHAR(100) UNIQUE,
    billing_cycle             VARCHAR(16),
    seats                     INTEGER NOT NULL DEFAULT 1,
    current_period_end        TIMESTAMPTZ,
    cancel_at_period_end      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscription_user UNIQUE (user_id)
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
