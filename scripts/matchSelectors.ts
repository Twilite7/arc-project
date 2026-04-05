import { ethers } from "ethers";

const candidates = new Set([
  "01ffc9a7","180aedf3","21eed1cd","23b872dd","248a9ca3",
  "2f0e31f4","2f2ff15d","3013ce29","36568abe","41528812",
  "41dd26f5","4300081c","4f1ef286","50355d76","52d1902d",
  "565b5b60","57615262","578063e1","5b7baf64","6133f156",
  "6d3b96c3","75b238fc","798d1461","84f15090","91906149",
  "91d14854","9e63798d","a217fddf","a3fe4783","a9059cbb",
  "ad3cb1cc","b4d884f6","bf22c457","c0c53b8b","ce79eb60",
  "d0fae591","d547741f","d75bbdf3","dc08fb1d","dd4ae9d4",
  "e138818c","e25ba707","fabc3329","ff96092a"
]);

const sigs = [
  "createJob(address,address,uint256,string,address)",
  "createJob(address,address,uint256,string)",
  "setBudget(uint256,uint256,bytes)","setBudget(uint256,uint256)",
  "fund(uint256,bytes)","fund(uint256)",
  "submit(uint256,bytes32,bytes)","submit(uint256,bytes32)",
  "complete(uint256,bytes32,bytes)","complete(uint256,bytes32)","complete(uint256)",
  "reject(uint256,bytes32,bytes)","reject(uint256,bytes32)",
  "reject(uint256,string,bytes)","reject(uint256,string)","reject(uint256)",
  "cancel(uint256,bytes32,bytes)","cancel(uint256)","refund(uint256)",
  "dispute(uint256,bytes32,bytes)","dispute(uint256)",
  "getJob(uint256)","jobs(uint256)","jobCount()",
  "token()","paymentToken()","usdc()","getToken()",
  "initialize(address)","initialize(address,address)","initialize(address,address,address)",
  "paused()","owner()",
  "supportsInterface(bytes4)",
  "hasRole(bytes32,address)","grantRole(bytes32,address)",
  "revokeRole(bytes32,address)","getRoleAdmin(bytes32)",
  "DEFAULT_ADMIN_ROLE()","proxiableUUID()",
  "upgradeToAndCall(address,bytes)",
  "UPGRADER_ROLE()","PAUSER_ROLE()","EVALUATOR_ROLE()",
];

for (const sig of sigs) {
  const sel = ethers.id(sig).slice(2, 10);
  if (candidates.has(sel)) {
    console.log("0x" + sel + "  " + sig);
  }
}
