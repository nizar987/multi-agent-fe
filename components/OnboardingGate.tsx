"use client";
import { useEffect, useState } from "react";
import Wizard from "./Wizard";

export default function OnboardingGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then((d) => setShow(!d.done))
      .catch(() => {});
  }, []);

  if (!show) return null;
  return <Wizard onDone={() => { setShow(false); window.location.href = "/"; }} />;
}
