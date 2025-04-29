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
import { signOut } from "@/lib/auth";

export function SignOut() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/auth?login" });
      }}
    >
      <button type="submit">Sign Out</button>
    </form>
  );
}
