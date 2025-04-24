import { auth } from "@/lib/auth";
import { SignOut } from "@/components/auth/sign-out";

const Page = async () => {
  const session = await auth();
  console.log("SESSION:", session);

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="bg-gray-100 rounded-lg p-4 text-center mb-6">
        <p className="text-gray-600">Signed in as:</p>
        <div className="flex flex-col gap-5">
          <p className="font-medium text-cyan-950">
            {session?.user.username || "No name found"}
          </p>
          <p className="font-medium text-cyan-950">
            {session?.user.email || "No email found"}
          </p>
        </div>
      </div>
      <SignOut />
    </div>
  );
};

export default Page;
