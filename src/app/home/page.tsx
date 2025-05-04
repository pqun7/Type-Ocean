// home page
import HeaderGame from "@/components/Typing";
import { NextPage } from "next";
import Header from "@/components/layout/Header/Header";

import VerifiedMessage from "@/components/auth/verification/VerifiedMessage";
// NOTE: sholde add Alert for verification
const Home: NextPage = ({}) => {
  return (
    <>
      <VerifiedMessage />
      <Header />

      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <HeaderGame />
      </div>
    </>
  );
};

export default Home;
