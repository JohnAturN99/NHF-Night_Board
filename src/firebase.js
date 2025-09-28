import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDxKVy9HidFLzTaB5tuEc1L2cmWHS2G3ek",
  authDomain: "night-dash-app.firebaseapp.com",
  projectId: "night-dash-app",
  storageBucket: "night-dash-app.firebasestorage.app",
  messagingSenderId: "522749838137",
  appId: "1:522749838137:web:d013102ea03df24f525ee8",
  measurementId: "G-J0J5XXGS7M"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// helpers
const provider = new GoogleAuthProvider();
export async function signInWithGoogleSmart() {
  return signInWithPopup(auth, provider);
}
export { onAuthStateChanged, signOut };

// (no-op; kept for API parity)
export function completeRedirectSignIn() {}
