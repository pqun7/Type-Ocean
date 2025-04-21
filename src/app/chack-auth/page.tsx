// /app/chack-auth/page.tsx
import { SignOut } from "@/components/auth/sign-out";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

const Page = async () => {
  const session = await auth();
//   if (!session) redirect("/auth?form=signup");

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="bg-gray-100 rounded-lg p-4 text-center mb-6">
        <p className="text-gray-600">Signed in as:</p>
        <p className="font-medium text-cyan-950">
          {session ? session.user?.email : "Not signed in"}
        </p>
      </div>
      <SignOut />
    </div>
  );
};

export default Page;
