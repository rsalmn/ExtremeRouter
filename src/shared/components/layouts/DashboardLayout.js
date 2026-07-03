"use client";

import { useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") return { wrapper: "border-success/25 bg-success/10 text-success", icon: "check_circle" };
  if (type === "error") return { wrapper: "border-danger/25 bg-danger/10 text-danger", icon: "error" };
  if (type === "warning") return { wrapper: "border-warning/25 bg-warning/10 text-warning", icon: "warning" };
  return { wrapper: "border-info/25 bg-info/10 text-info", icon: "info" };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg text-text-main">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.16),transparent_32rem),radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_28rem)]" aria-hidden="true" />

      <div className="fixed right-4 top-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div key={n.id} className={`rounded-brand border px-3 py-2 shadow-[var(--shadow-elev)] backdrop-blur-md ${style.wrapper}`}>
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="mb-0.5 text-xs font-semibold">{n.title}</p> : null}
                  <p className="whitespace-pre-wrap break-words text-xs">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button type="button" onClick={() => removeNotification(n.id)} className="text-current/70 hover:text-current" aria-label="Dismiss notification">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="relative hidden lg:flex"><Sidebar /></div>
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-out lg:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <main className="relative isolate flex h-full min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
