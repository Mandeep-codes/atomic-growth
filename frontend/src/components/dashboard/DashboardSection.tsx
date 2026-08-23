import { ReactNode } from "react";

/**
 * A band on the single-page clipper dashboard.
 *
 * Deliberately NOT collapsible. An earlier version made each section a toggle,
 * which just replaced the sidebar with a different set of things to click —
 * the whole point of the single page is that a clipper scrolls and everything
 * is already there. The cost is that every section's queries fire on load;
 * that is the trade being made on purpose.
 */
export const DashboardSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="overflow-hidden rounded-3xl border border-border/60 bg-card">
    <div className="border-b border-border/60 px-6 py-5">
      <h2 className="display-heading text-xl text-foreground sm:text-2xl">
        {title}
      </h2>
    </div>
    <div>{children}</div>
  </section>
);

export default DashboardSection;
