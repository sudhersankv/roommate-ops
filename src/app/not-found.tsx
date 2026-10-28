// 404.
import Link from "next/link";
import { Empty, PageHead } from "@/components/ui";

export default function NotFound() {
  return (
    <main data-accent="candy">
      <PageHead title="404 - Page not found." quip="Nothing at this address." />
      <div className="card">
        <Empty title="This page doesn't exist.">
          <div className="scream" aria-hidden="true">🤷</div>
          <p>Whatever you were looking for isn&apos;t here. Check the address, or head back home.</p>
          <Link className="btn" href="/">Go home</Link>
        </Empty>
      </div>
    </main>
  );
}
