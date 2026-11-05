"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

let initialized = false;

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    if (!token || !host) return;

    if (!initialized) {
      posthog.init(token, {
        api_host: host,
        defaults: "2026-08-30",
        opt_out_capturing_by_default: true,
        capture_pageview: false,
        capture_pageleave: false,
        person_profiles: "identified_only",
        mask_all_text: true,
        mask_all_element_attributes: true,
        enable_recording_console_log: false,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "*",
          blockSelector: 'input[type="hidden"], input[type="file"], iframe, img',
          recordHeaders: false,
          recordBody: false,
        },
      });
      initialized = true;
    }
    posthog.opt_in_capturing({ captureEventName: false });
    posthog.startSessionRecording();
    return () => {
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    posthog.capture("$pageview", {
      $current_url: window.location.origin + pathname,
      $pathname: pathname,
    });
  }, [pathname]);

  return null;
}
