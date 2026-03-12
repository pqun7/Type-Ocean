'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-10 text-center">
      <h2 className="mb-4 text-xl text-red-500">{error.message || "Something went wrong!"}</h2>
      <button
        onClick={() => reset()}
        className="rounded bg-blue-500 px-4 py-2 text-white"
      >
        Try Again
      </button>
    </div>
  );
}