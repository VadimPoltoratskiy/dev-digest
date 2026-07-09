/* Onboarding tour route — /onboarding. Thin wrapper; the screen lives in
   _components/OnboardingView. The add-repository form has moved to
   AddRepoModal (components/add-repo-modal/). */

import { OnboardingView } from "./_components/OnboardingView";

export default function OnboardingPage() {
  return <OnboardingView />;
}
