// "use client";
// import { Button } from "@/components/ui/button";
// import { signOut } from "next-auth/react";

// const SignOut = () => {
//   const handleSignOut = async () => {
//     await signOut();
//   };

//   return (
//     <div className="flex justify-center">
//       <Button variant="destructive" onClick={handleSignOut}>
//         Sign Out
//       </Button>
//     </div>
//   );
// };

// export { SignOut };
import { signOut } from "@/features/auth/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SignOutProps = {
  label?: string;
  redirectTo?: string;
  className?: string;
};

export function SignOut({ label = "Sign Out", redirectTo = "/auth", className }: SignOutProps) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo });
      }}
    >
      <Button
        type="submit"
        variant="destructive"
        className={cn("w-full", className)}
      >
        {label}
      </Button>
    </form>
  );
}
