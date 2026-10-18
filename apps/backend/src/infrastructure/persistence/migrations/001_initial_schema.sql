CREATE TABLE communication_identities (
  channel text NOT NULL,
  external_id text NOT NULL,
  user_id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (channel, external_id)
);
CREATE INDEX communication_identities_user_id_idx ON communication_identities (user_id);

CREATE TABLE user_profiles (
  user_id text PRIMARY KEY,
  payload jsonb NOT NULL
);

CREATE TABLE user_eligibility (
  user_id text PRIMARY KEY,
  payload jsonb NOT NULL
);

CREATE TABLE profile_drafts (
  user_id text PRIMARY KEY,
  payload jsonb NOT NULL
);

CREATE TABLE match_queue (
  user_id text PRIMARY KEY,
  enqueued_at timestamptz NOT NULL
);
CREATE INDEX match_queue_enqueued_at_idx ON match_queue (enqueued_at);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX conversations_active_idx ON conversations (created_at) WHERE status = 'active';
CREATE INDEX conversations_participants_idx ON conversations USING gin ((payload->'participants'));

CREATE TABLE reports (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE point_events (
  id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  points integer NOT NULL
);
CREATE INDEX point_events_user_created_at_idx ON point_events (user_id, created_at);

CREATE TABLE moderation_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX moderation_events_user_id_idx ON moderation_events (user_id);
CREATE INDEX moderation_events_created_at_idx ON moderation_events (created_at DESC);
