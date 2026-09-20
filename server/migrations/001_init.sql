CREATE TABLE IF NOT EXISTS clients (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  api_key    VARCHAR(64)  NOT NULL,
  weight     DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_clients_api_key (api_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  client_id        CHAR(36)     NOT NULL,
  type             VARCHAR(64)  NOT NULL,
  priority         TINYINT      NOT NULL,
  payload          JSON         NOT NULL,
  status           ENUM('queued','running','cancelling','completed','failed','cancelled','dead_letter')
                                NOT NULL DEFAULT 'queued',
  attempts         INT          NOT NULL DEFAULT 0,
  max_attempts     INT          NOT NULL DEFAULT 4,
  worker_id        VARCHAR(64)  NULL,
  lease_expires_at TIMESTAMP(3) NULL,
  last_error       TEXT         NULL,
  result           JSON         NULL,
  enqueued_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at       TIMESTAMP(3) NULL,
  last_attempt_at  TIMESTAMP(3) NULL,
  finished_at      TIMESTAMP(3) NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tasks_client FOREIGN KEY (client_id) REFERENCES clients (id),
  KEY idx_status_created (status, created_at),
  KEY idx_client_status (client_id, status),
  KEY idx_type_status (type, status),
  KEY idx_lease (status, lease_expires_at),
  KEY idx_finished (finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
