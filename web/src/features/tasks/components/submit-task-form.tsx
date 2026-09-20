import { useState, type FormEvent } from 'react';
import { MAX_PRIORITY, MIN_PRIORITY, TASK_TYPES, createTaskSchema } from '@task-engine/shared';
import { ApiError } from '../../../lib/api-client';
import { useCreateTask } from '../api/create-task';

const PRIORITIES = Array.from(
  { length: MAX_PRIORITY - MIN_PRIORITY + 1 },
  (_, index) => MAX_PRIORITY - index,
);

const DEFAULT_PAYLOAD = '{\n  "durationMs": 8000\n}';

export function SubmitTaskForm() {
  const [type, setType] = useState<string>(TASK_TYPES[0]);
  const [priority, setPriority] = useState(3);
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD);
  const [validationError, setValidationError] = useState<string | null>(null);

  const createTask = useCreateTask();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidationError(null);

    let payload: unknown;
    try {
      payload = payloadText.trim() === '' ? {} : JSON.parse(payloadText);
    } catch {
      setValidationError('Payload must be valid JSON');
      return;
    }

    // The same schema the server validates against, so the form cannot disagree
    // with the API about what a task looks like.
    const parsed = createTaskSchema.safeParse({ type, priority, payload });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Invalid task');
      return;
    }

    createTask.mutate(parsed.data);
  };

  const serverError = createTask.error;

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 className="card__title">Submit a task</h2>

      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="task-type">Type</label>
          <select
            id="task-type"
            className="select"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {TASK_TYPES.map((taskType) => (
              <option key={taskType} value={taskType}>
                {taskType}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="task-priority">Priority</label>
          <select
            id="task-priority"
            className="select"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
                {value === MAX_PRIORITY ? ' (highest)' : value === MIN_PRIORITY ? ' (lowest)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="task-payload">
          Payload — <code>durationMs</code> and <code>failureRate</code> override the type&apos;s
          profile
        </label>
        <textarea
          id="task-payload"
          className="textarea"
          rows={5}
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
        />
      </div>

      {validationError !== null && <p className="error-banner">{validationError}</p>}
      {serverError !== null && (
        <p className="error-banner">
          {serverError instanceof ApiError ? serverError.message : 'Submission failed'}
        </p>
      )}

      <div className="row">
        <button type="submit" className="button button--primary" disabled={createTask.isPending}>
          {createTask.isPending ? 'Submitting…' : 'Submit task'}
        </button>
        {createTask.isSuccess && <span className="muted">Queued.</span>}
      </div>
    </form>
  );
}
