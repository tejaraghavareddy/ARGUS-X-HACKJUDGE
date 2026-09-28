import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="nb-card w-full max-w-lg p-8">
        <span className="inline-block border-2 border-ink bg-[#ffe500] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest">
          Error 404
        </span>
        <h1 className="mt-5 text-4xl font-black tracking-tight">
          This page is not on the run sheet.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may be out of date, or you may not have access to it. If you
          think you should be able to see this, an organizer can check your
          role.
        </p>
        <Link
          to="/"
          className="nb-press mt-6 inline-flex h-11 items-center gap-2 border-2 border-ink bg-primary px-5 text-sm font-bold uppercase tracking-wide text-primary-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
