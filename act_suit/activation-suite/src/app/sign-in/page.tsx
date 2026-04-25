import type { Metadata } from "next";
import { SignInPanel } from "@/components/auth/SignInPanel";

export const metadata: Metadata = {
  title: "Gap Map — Sign in",
};

// Sign-in is client-driven; keep it dynamic so session state is never cached.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignInPanel />;
}
