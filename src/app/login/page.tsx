import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-500">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
