export default function ClaimDetailLoading() {
  return (
    <div className="nxt-page-bg">
      {/* Header placeholder */}
      <div className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-zinc-200/60 bg-white/80 px-4 backdrop-blur-xl sm:px-6 dark:border-zinc-800/60 dark:bg-zinc-950/80">
        <div className="shimmer-sweep h-6 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
        <div className="flex items-center gap-2">
          <div className="shimmer-sweep h-9 w-9 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
          <div className="shimmer-sweep h-9 w-24 rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
        </div>
      </div>

      <div className="relative z-0 mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="space-y-5">
          {/* Back button skeleton */}
          <div className="shimmer-sweep h-9 w-24 rounded-xl bg-indigo-100/80 dark:bg-indigo-900/20" />

          {/* Page header card skeleton */}
          <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14)] backdrop-blur-lg dark:border-zinc-800/80 dark:bg-zinc-900/88">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
            <div className="px-5 py-4 sm:px-6">
              <div className="space-y-2">
                <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-7 w-44 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-3 w-64 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              </div>
            </div>
          </section>

          {/* Claim detail content skeleton */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="shimmer-sweep h-3 w-20 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-8 w-48 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                <div className="shimmer-sweep h-4 w-56 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              </div>
              <div className="shimmer-sweep h-7 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <article
                  key={`skel-meta-${index}`}
                  className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="shimmer-sweep h-3 w-24 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                  <div className="shimmer-sweep mt-2 h-4 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
                </article>
              ))}
            </div>
            <section className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="shimmer-sweep h-4 w-32 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`skel-detail-${index}`}
                    className="shimmer-sweep h-4 w-full rounded-md bg-zinc-200 dark:bg-gray-800/40"
                  />
                ))}
              </div>
            </section>
          </section>

          {/* Evidence skeleton */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
            <div className="shimmer-sweep h-4 w-36 rounded-md bg-zinc-200 dark:bg-gray-800/40" />
            <div className="shimmer-sweep mt-4 h-[460px] w-full rounded-lg bg-zinc-200 dark:bg-gray-800/40" />
          </section>
        </main>
      </div>
    </div>
  );
}
