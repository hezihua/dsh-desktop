import { Suspense } from "react";
import { ServerAnalysisView } from "@/components/ServerAnalysisView";
import { I18nLoading } from "@/components/I18nLoading";

export default function AnalysisPage() {
  return (
    <Suspense fallback={<I18nLoading />}>
      <ServerAnalysisView />
    </Suspense>
  );
}
