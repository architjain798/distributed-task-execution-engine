export function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
