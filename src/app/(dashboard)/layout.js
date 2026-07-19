import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { DashboardLayout } from "@/shared/components";

/**
 * Server-side auth gate for all /dashboard/* routes.
 *
 * When `requireLogin` is enabled (the default), verifies the auth_token
 * cookie against the JWT session store. Invalid or missing tokens redirect
 * to /login. When `requireLogin` is false (local-only mode), access is
 * open — consistent with the API layer's behavior.
 */
export default async function DashboardRootLayout({ children }) {
  const settings = await getSettings();
  if (settings.requireLogin !== false) {
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    if (!session) {
      redirect("/login");
    }
  }
  return <DashboardLayout>{children}</DashboardLayout>;
}

