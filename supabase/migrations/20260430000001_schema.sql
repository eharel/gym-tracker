create table if not exists programs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean default false,
  created_at  timestamptz default now()
);

create table if not exists workout_templates (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid references programs(id) on delete cascade,
  name             text not null,
  order_in_program integer not null,
  warmup_text      text,
  cooldown_text    text,
  created_at       timestamptz default now()
);

create table if not exists exercise_templates (
  id                   uuid primary key default gen_random_uuid(),
  workout_template_id  uuid references workout_templates(id) on delete cascade,
  name                 text not null,
  position             integer not null,
  rpe_target           text,
  notes                text,
  superset_group       text,
  is_optional          boolean default false,

  -- warmup_rule enum: percentage_of_top_set | dumbbell_percentage | fixed_weight | none
  warmup_rule          text not null default 'percentage_of_top_set',
  warmup_percentages   jsonb,
  warmup_reps          jsonb,
  warmup_db_percentage float,
  warmup_db_reps       integer,
  warmup_fixed_weight  float,
  warmup_fixed_reps    integer,

  -- working_set_type enum: top_set | straight_sets | amrap
  working_set_count    integer not null default 1,
  working_set_type     text not null default 'top_set',
  working_rep_target   text,

  backoff_set_count    integer not null default 0,
  backoff_percentage   float,
  backoff_rep_target   text,

  weight_increment     float default 5.0,
  rounding_increment   float default 5.0,

  created_at           timestamptz default now()
);

create table if not exists sessions (
  id                  uuid primary key default gen_random_uuid(),
  workout_template_id uuid references workout_templates(id),
  started_at          timestamptz default now(),
  completed_at        timestamptz,
  notes               text
);

create table if not exists set_logs (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid references sessions(id) on delete cascade,
  exercise_template_id uuid references exercise_templates(id),
  set_index            integer not null,
  -- set_type enum: warmup | top | backoff | working | amrap
  set_type             text not null,
  target_weight        float,
  actual_weight        float,
  target_reps          text,
  actual_reps          integer,
  is_weight_override   boolean default false,
  completed            boolean default false,
  created_at           timestamptz default now()
);

create table if not exists exercise_notes (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid references sessions(id) on delete cascade,
  exercise_template_id uuid references exercise_templates(id),
  note                 text not null,
  created_at           timestamptz default now()
);

-- indexes for common query patterns
create index if not exists idx_workout_templates_program_id on workout_templates(program_id);
create index if not exists idx_exercise_templates_workout_id on exercise_templates(workout_template_id);
create index if not exists idx_sessions_workout_template_id on sessions(workout_template_id);
create index if not exists idx_sessions_completed_at on sessions(completed_at);
create index if not exists idx_set_logs_session_id on set_logs(session_id);
create index if not exists idx_set_logs_exercise_template_id on set_logs(exercise_template_id);
