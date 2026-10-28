"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <div className="notice err" role="alert"><h2>Something went wrong</h2><p>The page could not be loaded. Details are in the server log.</p><button onClick={reset}>Try again</button></div>;
}
