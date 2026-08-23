import { randomAliasDomain } from "./forwardEmail";

export const generateStrongPassword = () => {
  const words = [
    "alpha",
    "beta",
    "delta",
    "gamma",
    "theta",
    "lambda",
    "omega",
    "kappa",
    "sigma",
    "zeta",
    "nova",
    "quantum",
    "stellar",
    "orbit",
    "cosmic",
    "neutron",
    "proton",
    "fusion",
    "galaxy",
    "meteor",
    "asteroid",
    "comet",
    "nebula",
    "solar",
    "lunar",
    "titan",
    "phoenix",
    "zenith",
    "apex",
    "horizon",
    "vertex",
    "matrix",
    "cipher",
    "binary",
    "vector",
    "pixel",
    "vortex",
    "ripple",
    "flux",
    "pulse",
    "static",
    "dynamic",
    "kinetic",
    "ion",
    "plasma",
    "signal",
    "module",
    "core",
    "prime",
    "phase",
  ];

  const specialChars = ["!", "$", "?"];

  function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  const selectedWords = Array.from({ length: 2 }, () => {
    const index = Math.floor(Math.random() * words.length);
    const word = words[index];
    return capitalize(word ?? "");
  });

  const digits = `${Math.floor(Math.random() * 10)}${Math.floor(
    Math.random() * 10
  )}`;
  const special = specialChars[Math.floor(Math.random() * specialChars.length)];

  return `${selectedWords.join("")}${digits}${special}`;
};

// The old inbound.new domains (atomikmail.com, atomikclipper.com, emaildxb.com,
// mailslaps.com, nochillmail.com, pingmailr.com, postmailo.com, sendmaila.com,
// smashtok.com, xmailor.com, getrichmail.com, choppedemail.com) stay retired
// until their registrar logins are recovered; new credentials randomize across
// the ForwardEmail-verified ALIAS_DOMAINS.
const domainRandomizer = randomAliasDomain;

export const normalizeHandleInput = (rawHandle: string) =>
  rawHandle.trim().replace(/^@+/, "");

export const generateCredentialPair = (handle: string) => {
  const cleanedHandle = normalizeHandleInput(handle);
  if (!cleanedHandle) {
    return null;
  }

  return {
    email: `${cleanedHandle.toLowerCase()}@${domainRandomizer()}`,
    password: generateStrongPassword(),
  };
};
