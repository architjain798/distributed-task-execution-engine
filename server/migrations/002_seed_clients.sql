-- Four demo clients. `initech` carries weight 2.00 so the Deficit Round Robin
-- scheduler is exercised with non-uniform weights rather than degenerating to
-- plain round robin; it receives twice the dispatch rate of the others.
INSERT INTO clients (id, name, api_key, weight) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Acme',     'acme-key-001',     1.00),
  ('22222222-2222-4222-8222-222222222222', 'Globex',   'globex-key-002',   1.00),
  ('33333333-3333-4333-8333-333333333333', 'Initech',  'initech-key-003',  2.00),
  ('44444444-4444-4444-8444-444444444444', 'Umbrella', 'umbrella-key-004', 1.00)
ON DUPLICATE KEY UPDATE name = VALUES(name), weight = VALUES(weight);
