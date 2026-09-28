import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="surface-card w-full max-w-lg p-7">
        <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
          Error 404
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.021em]">
          This page is not on the run sheet.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The link may be out of date, or you may not have access to it. If you
          think you should be able to see this, an organizer can check your
          role.
        </p>
        <Link to="/" className="btn-base btn-primary mt-6">
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
