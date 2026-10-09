"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Wizard from "./Wizard";

export default function OnboardingGate() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d) => setShow(!d.done))
      .catch(() => {});
  }, []);

  if (!show) return null;
  return (
    <Wizard
      onDone={() => {
        setShow(false);
        router.push("/");
        router.refresh(); // revalidate server components
      }}
    />
  );
}
