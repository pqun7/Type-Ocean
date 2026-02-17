// home page
import HeaderGame from "@/components/Typing";
import Header from "@/components/layout/Header/Header";
import VerifiedMessage from "@/components/auth/verification/VerifiedMessage";
import { SignOut } from "@/components/auth/sign-out";
import { NextPage } from "next";

// NOTE: sholde add Alert for verification
const Home: NextPage = ({}) => {
  return (
    <>
      <VerifiedMessage />
      <Header />

      <div className="fixed top-4 right-4 z-50 w-28">
        <SignOut label="Logout" />
      </div>

      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <HeaderGame />
      </div>


    </>
  );
};

export default Home;
