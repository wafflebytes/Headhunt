const imgDitherAsciiPro17755142232861 = "/assets/dot-matrix-headie.png";

export default function LoginPage() {
  return (
    <div className="bg-[#131313] min-h-screen w-full flex flex-col gap-[33px] items-start pl-[30px] pr-[82px] relative overflow-hidden">
      <svg width="0" height="0" className="absolute pointer-events-none">
        <filter id="inner-shadow">
          <feOffset dx="2" dy="2" />
          <feGaussianBlur stdDeviation="7.75" result="offset-blur" />
          <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse" />
          <feFlood floodColor="black" floodOpacity="1" result="color" />
          <feComposite operator="in" in="color" in2="inverse" result="shadow" />
          <feComposite operator="over" in="shadow" in2="SourceGraphic" />
        </filter>
      </svg>
      <div className="flex gap-[148px] h-[217px] items-center leading-[normal] not-italic relative shrink-0 z-10">
        <p className="font-serif relative shrink-0 text-[#b3b3b3] text-[182px] tracking-tight whitespace-nowrap" style={{ filter: 'url(#inner-shadow)' }}>
          Headhunt
        </p>
        <div className="flex flex-col font-sans gap-[22px] items-start relative shrink-0 text-[#807d7d] text-[25px] w-[179px] ml-[8rem] mt-[2rem]">
          <p className="relative shrink-0 w-full leading-tight">
            Do hiring, stupidly fast.
          </p>
          <a href="/auth/login?prompt=login&max_age=0" className="decoration-solid relative shrink-0 underline w-full hover:text-white transition-colors cursor-pointer">
            Get started
          </a>
        </div>
      </div>
      <div className="absolute h-[52rem] left-[48rem] top-[20rem] w-[780px] pointer-events-none z-0">
        <div className="absolute inset-0 overflow-hidden">
          <img alt="background ascii art" className="absolute h-[171.29%] left-[-42.53%] max-w-none top-[-36.74%] w-[181.44%] opacity-80 mix-blend-screen" src={imgDitherAsciiPro17755142232861} />
        </div>
      </div>
    </div>
  );
}
