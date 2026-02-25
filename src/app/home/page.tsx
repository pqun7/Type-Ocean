// home page
import HeaderGame from "@/components/Typing";
import Header from "@/components/layout/Header/Header";
import VerifiedMessage from "@/components/auth/verification/VerifiedMessage";
import HomePvpTiles from "@/components/pvp/HomePvpTiles";
import { NextPage } from "next";

// NOTE: sholde add Alert for verification
const Home: NextPage = ({}) => {
  return (
    <>
      <VerifiedMessage />
      <Header />

      <div className="pt-[6.5rem] pb-10">
        <div className="mt-10 flex justify-center px-4">
          <HeaderGame />
        </div>

        <div className="mt-10">
          <HomePvpTiles />
        </div>
      </div>
    </>
  );
};

export default Home;
