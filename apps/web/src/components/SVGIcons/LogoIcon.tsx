import { useEffect } from "react";

const css = `
@keyframes wave {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes float {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

@keyframes sway {
  0%,100% { transform: rotate(0deg); }
  25% { transform: rotate(1.5deg); }
  75% { transform: rotate(-1.5deg); }
}

@keyframes pulse-icon {
  0%,100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

@keyframes stretch {
  0%,100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(1.12);
  }
}

@keyframes breathe {
  0%,100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.el-s{
    transform-box:fill-box;
    transform-origin:center;
    animation:sway 5s ease-in-out infinite;
}

.el-r1{
    transform-box:fill-box;
    transform-origin:center;
    animation:float 2.2s ease-in-out infinite;
}

.el-r2{
    transform-box:fill-box;
    transform-origin:center;
    animation:float 2.2s ease-in-out .3s infinite;
}

.el-r3{
    transform-box:fill-box;
    transform-origin:center;
    animation:pulse-icon 2.5s ease-in-out infinite;
}

.el-tri{
    transform-box:fill-box;
    transform-origin:center;
    animation:breathe 2.4s ease-in-out infinite;
}

.el-bar{
    transform-box:fill-box;
    transform-origin:bottom;
    animation:stretch 2s ease-in-out infinite;
}

.el-j{
    transform-box:fill-box;
    transform-origin:center;
    animation:sway 4.5s ease-in-out .4s infinite;
}

.el-q{
    transform-box:fill-box;
    transform-origin:center;
    animation:
        pulse-icon 3s ease-in-out infinite,
        sway 6s ease-in-out infinite;
}

/* SIMPP */

.el-ms{
    transform-box:fill-box;
    transform-origin:center;
    animation:wave 1.8s ease-in-out 0s infinite;
}

.el-mi{
    transform-box:fill-box;
    transform-origin:center;
    animation:wave 1.8s ease-in-out .2s infinite;
}

.el-mm{
    transform-box:fill-box;
    transform-origin:center;
    animation:wave 1.8s ease-in-out .4s infinite;
}

.el-mp1{
    transform-box:fill-box;
    transform-origin:center;
    animation:wave 1.8s ease-in-out .6s infinite;
}

.el-mp2{
    transform-box:fill-box;
    transform-origin:center;
    animation:wave 1.8s ease-in-out .8s infinite;
}

/* ULTIMATE */

.el-ts{
    transform-box:fill-box;
    transform-origin:center;
    animation:breathe 2.5s ease-in-out infinite;
}
`;

const LogoIcon = ({ size = 919, color = "#111", darkMode = false }) => {
  useEffect(() => {
    if (!document.getElementById("logo-anim-styles")) {
      const tag = document.createElement("style");
      tag.id = "logo-anim-styles";
      tag.textContent = css;
      document.head.appendChild(tag);
    }
  }, []);

  const width = size;
  const height = Math.round((size * 256) / 919);

  // Dark-mode fills, taken from the official colored logo reference.
  const tealGradFill = darkMode ? "url(#tealGrad)" : color; // S-shape, rects, bar
  const tealSolidFill = darkMode ? "#15657C" : color; // triangle, J-shape
  const lightTextFill = darkMode ? "#C4E7ED" : color; // ULTIMATE, P1, P2
  const cyanTextFill = darkMode ? "#149FB4" : color; // S, I, M

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 919 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient
          id="g1"
          x1="162.374"
          y1="156.212"
          x2="296.939"
          y2="156.212"
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBA806" />
          <stop offset="1" stopColor="#FCBA0B" />
        </linearGradient>

        {/* Dark-mode teal gradient: linear-gradient(180deg, #89D0DB 0%, #008BA0 100%) */}
        <linearGradient id="tealGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#89D0DB" />
          <stop offset="100%" stopColor="#008BA0" />
        </linearGradient>
      </defs>

      {/* S-shape */}
      <path
        className="el-s"
        fill={tealGradFill}
        d="M147.69 28.4551C161.619 21.86 166.363 14.1503 169.548 0H75.1534C57.6395 0 39.6341 3.48749 26.5594 15.1403C-17.5491 54.4517 -2.81166 113.022 42.1191 133.782L89.7724 157.786C119.605 172.128 125.652 201.894 101.114 218.134C94.1161 222.765 85.4759 223.794 77.0845 223.794H44.855C40.2184 223.794 35.5583 224.14 31.0951 225.396C15.7743 229.708 9.84508 237.192 6.11431 255.563H74.011C98.1467 255.563 123.336 248.509 136.644 228.374C160.496 192.287 151.341 153.685 116.953 133.782L61.1804 105.896C29.9889 92.3084 24.4647 58.7277 48.8624 39.8998C56.3035 34.1574 66.022 32.8279 75.4212 32.8279H124.907C132.728 32.8279 140.622 31.8018 147.69 28.4551Z"
      />

      {/* Floating rects */}
      <rect
        className="el-r1"
        x="89.6592"
        y="78.7163"
        width="16.2374"
        height="16.2374"
        rx="0.705976"
        fill={tealGradFill}
      />
      <rect
        className="el-r2"
        x="110.838"
        y="58.2432"
        width="15.5315"
        height="15.5315"
        rx="0.705976"
        fill={tealGradFill}
      />
      <rect
        className="el-r3"
        x="120.722"
        y="87.188"
        width="28.239"
        height="28.239"
        rx="0.705976"
        fill={tealGradFill}
      />

      {/* Triangle */}
      <path
        className="el-tri"
        fill={tealSolidFill}
        d="M153.903 251.68H134.842C143.949 242.848 148.085 237.428 153.903 226.971V251.68Z"
      />

      {/* Vertical bar */}
      <rect
        className="el-bar"
        x="161.668"
        y="189.555"
        width="18.3554"
        height="62.1259"
        rx="0.705976"
        fill={tealGradFill}
      />

      {/* J-shape */}
      <path
        className="el-j"
        fill={tealSolidFill}
        d="M187.084 164.14C187.084 163.75 187.4 163.434 187.79 163.434H204.733C205.123 163.434 205.439 163.75 205.439 164.14V233.507C205.439 243.544 197.303 251.681 187.266 251.681C187.165 251.681 187.084 251.599 187.084 251.499V164.14Z"
      />

      {/* Q/omega — gradient (unchanged in both modes) */}
      <path
        className="el-q"
        fill="url(#g1)"
        d="M230.046 117.192H177.905C169.328 117.192 162.374 110.238 162.374 101.66V94.9536C162.374 89.8849 166.483 85.7759 171.552 85.7759H228.95C236.084 85.7759 243.313 86.3179 250.115 88.4707C326.995 112.805 298.92 212.203 239.678 213.557C233.397 213.557 226.6 214.249 222.243 218.773C220.352 220.737 218.587 223.199 216.85 226.648L217.03 197.478C217.048 194.59 217.752 191.748 219.085 189.186C221.13 185.253 225.089 182.682 229.514 182.411L230.333 182.361C236.534 181.981 242.863 181.067 248.093 177.714C267.649 165.176 270.792 137.86 248.05 121.953C242.85 118.316 236.393 117.192 230.046 117.192Z"
      />

      {/* Subtext: ULTIMATE */}
      <path
        className="el-ts"
        fill={lightTextFill}
        d="M431.548 194.49C427.691 194.49 424.675 193.416 422.5 191.267C420.326 189.119 419.239 186.051 419.239 182.065V166.844H425.529V181.832C425.529 184.42 426.06 186.284 427.121 187.423C428.182 188.562 429.671 189.132 431.586 189.132C433.502 189.132 434.99 188.562 436.052 187.423C437.113 186.284 437.644 184.42 437.644 181.832V166.844H443.856V182.065C443.856 186.051 442.769 189.119 440.595 191.267C438.42 193.416 435.405 194.49 431.548 194.49ZM481.135 194.024V166.844H487.425V188.899H501.054V194.024H481.135ZM538.342 194.024V171.969H529.645V166.844H553.33V171.969H544.632V194.024H538.342ZM587.777 194.024V166.844H594.068V194.024H587.777ZM631.581 194.024V166.844H636.784L648.355 186.025H645.598L656.975 166.844H662.139L662.217 194.024H656.315L656.276 175.891H657.363L648.277 191.151H645.443L636.163 175.891H637.483V194.024H631.581ZM696.156 194.024L708.271 166.844H714.483L726.637 194.024H720.036L710.096 170.028H712.581L702.602 194.024H696.156ZM702.213 188.2L703.883 183.424H717.861L719.57 188.2H702.213ZM764.785 194.024V171.969H756.087V166.844H779.772V171.969H771.075V194.024H764.785ZM814.22 194.024V166.844H834.76V171.892H820.471V188.976H835.265V194.024H814.22ZM820.005 182.686V177.794H833.091V182.686H820.005Z"
      />

      {/* Main text: S — wave delay 0s */}
      <path
        className="el-ms"
        fill={cyanTextFill}
        d="M361.611 63.5381H433.732V77.8203H358.775C355.438 77.8203 351.569 78.0914 350.206 81.1368C349.7 82.2676 349.429 83.573 349.446 84.8867C349.517 90.516 356.658 91.6945 362.287 91.6945H409.04C414.335 91.6945 419.781 91.8769 424.573 94.1285C441.376 102.024 441.711 122.312 424.982 130.613C419.958 133.106 414.174 133.317 408.566 133.317H332.94V119.851H405.904C411.343 119.851 418.241 119.449 419.833 114.248C420.229 112.954 420.208 111.606 419.756 110.325C418.026 105.431 411.478 105.161 406.286 105.161H356.329C352.454 105.161 348.509 104.764 345.016 103.087C328.572 95.1913 328.996 77.8148 340.611 68.5085C346.372 63.8925 354.229 63.5381 361.611 63.5381Z"
      />

      {/* Main text: I — wave delay 0.3s */}
      <path
        className="el-mi"
        fill={cyanTextFill}
        d="M494.891 63.5381H478.16V133.317H494.891V63.5381Z"
      />

      {/* Main text: M — wave delay 0.6s */}
      <path
        className="el-mm"
        fill={cyanTextFill}
        d="M535.697 63.5381V132.909H552.428V83.5332L586.705 122.707H598.539L632.817 83.5332V132.909H648.731V63.5381H628.736L592.418 105.161L557.325 63.5381H535.697Z"
      />

      {/* Main text: P1 — wave delay 0.9s */}
      <path
        className="el-mp1"
        fill={lightTextFill}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M763.805 64.3545H689.537V133.725H705.452V110.874H763.805C789.105 108.425 791.961 69.6593 763.805 64.3545ZM705.044 78.2287H758.5C770.742 81.0851 769.926 96.1835 758.5 98.2238H705.044V78.2287Z"
      />

      {/* Main text: P2 — wave delay 1.2s */}
      <path
        className="el-mp2"
        fill={lightTextFill}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M898.94 64.3545H824.672V133.725H840.586V110.874H898.94C924.24 108.425 927.096 69.6593 898.94 64.3545ZM840.178 78.2287H893.635C905.877 81.0851 905.061 96.1835 893.635 98.2238H840.178V78.2287Z"
      />
    </svg>
  );
};

export default LogoIcon;
