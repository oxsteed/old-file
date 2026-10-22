import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import api from "../api/auth";
import { useAuth } from "../context/AuthContext";
export default function PolicyNotice() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    let active = true;
    setNotice(null);
    api
      .get("/activity/policy")
      .then(({ data }) => {
        if (data.dismissed) return;
        try {
          if (
            !data.authenticated &&
            localStorage.getItem(`growth-notice:${data.policy_version}`)
          )
            return;
        } catch {}
        if (
          active &&
          data.notice_started &&
          (!data.effective_at ||
            Date.now() < new Date(data.effective_at).getTime() + 30 * 86400000)
        )
          setNotice(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);
  if (!notice) return null;
  const effective =
    notice.effective_at && new Date(notice.effective_at) <= new Date();
  const date = notice.effective_at || notice.planned_effective_at;
  if (!date) return null;
  const dismiss = async () => {
    try {
      await api.post("/activity/notice/dismiss");
    } catch {}
    try {
      if (!notice.authenticated)
        localStorage.setItem(`growth-notice:${notice.policy_version}`, "1");
    } catch {}
    setNotice(null);
  };
  return (
    <aside
      aria-label={t("growthInsights.policy")}
      className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
      data-track-private
    >
      <p>
        {t(
          effective ? "growthInsights.changedOn" : "growthInsights.changesOn",
          {
            date: new Date(date).toLocaleDateString(i18n.resolvedLanguage),
          },
        )}{" "}
        <Link
          className="underline"
          to={effective ? "/privacy" : "/privacy/upcoming"}
        >
          {t("growthInsights.policy")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="rounded border border-current px-3 py-2"
      >
        {t("growthInsights.dismiss")}
      </button>
    </aside>
  );
}
