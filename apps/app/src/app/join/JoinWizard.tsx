"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon, IdCardScanner } from "@esoqo/ui";
import {
  parseKenyanIdText,
  filledNationalIdFields,
  type ParsedNationalId,
} from "@esoqo/domain";
import {
  actionStartJoin,
  actionUploadJoinDocument,
  actionSendJoinOtp,
  actionVerifyJoinOtp,
  actionCompleteJoin,
  actionConfirmHandle,
  type JoinDetails,
} from "./actions";
import { DetailsForm } from "./DetailsForm";

type Step =
  | "start-choice"
  | "capture"
  | "extracting"
  | "name"
  | "contact"
  | "location"
  | "id-details"
  | "otp"
  | "pick-handle"
  | "done";

/** The chama invite this signup is finishing, when there is one — read
 *  server-side from the `?i=` token in page.tsx. */
export interface JoinInvite {
  token: string;
  orgName: string;
  inviterName?: string;
  joinFeeKes: number;
  msisdn?: string;
  email?: string;
  firstName?: string;
  middleName?: string;
  surname?: string;
}

const EMPTY_DETAILS: JoinDetails = {
  firstName: "",
  middleName: "",
  surname: "",
  dateOfBirth: "",
  sex: "",
  county: "",
  ward: "",
  msisdn: "+254 7",
  email: "",
  idNumber: "",
  serialNumber: "",
  districtOfBirth: "",
  dateOfIssue: "",
};

/** Every ParsedNationalId field that has a form input behind it. Anything
 *  outside this list (placeOfIssue) is read off the card to help derive
 *  something else and never shown as its own field. */
const SCANNED_FIELDS = [
  "firstName",
  "middleName",
  "surname",
  "dateOfBirth",
  "sex",
  "county",
  "districtOfBirth",
  "idNumber",
  "serialNumber",
  "dateOfIssue",
] as const satisfies ReadonlyArray<keyof JoinDetails & keyof ParsedNationalId>;

type ScannedField = (typeof SCANNED_FIELDS)[number];

/**
 * Runs tesseract.js against a photo, client-side — no image or extracted
 * text ever leaves the browser during this step. Best-effort only: see
 * parseKenyanIdText's own doc comment for why every field this produces
 * lands in an editable input, never written straight through.
 *
 * `onProgress` is wired to tesseract's own logger because the OCR pass is
 * the one genuinely slow moment in this flow — several seconds on a mid
 * range phone, with nothing happening on screen. A bare "Reading your
 * ID…" for that long reads as a hang, and someone who reloads the page
 * loses the photos they just took.
 */
async function extractText(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const { createWorker, OEM } = await import("tesseract.js");

  // LSTM_ONLY rather than the default combined engine: it reads the
  // machine-printed sans-serif on an ID card at least as well and skips
  // downloading the legacy model, which on a phone is the difference
  // between a few seconds and rather more than that.
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) => {
      // Only the recognition phase maps onto a meaningful fraction; the
      // model download and warm-up report their own progress and would
      // otherwise make the bar run to full and restart.
      if (m.status === "recognizing text") onProgress(m.progress);
    },
  });

  // Preprocess image for better OCR results
  const bitmap = await readImageFile(file);
  const enhancedBitmap = enhanceBitmap(bitmap);
  const enhancedFile = await bitmapToFile(enhancedBitmap, file.name);

  try {
    const { data } = await worker.recognize(enhancedFile);
    return postProcessOcrText(data.text);
  } finally {
    await worker.terminate();
  }
}

/**
 * Reads a File into an image bitmap for processing.
 */
function readImageFile(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Enhances the bitmap for better OCR by:
 * - Converting to grayscale
 * - Applying adaptive thresholding
 * - Increasing contrast
 */
function enhanceBitmap(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const grayData = new Uint8ClampedArray(width * height);

  // Convert to grayscale first
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // Luminance formula for grayscale
    grayData[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Calculate global mean for adaptive thresholding
  let sum = 0;
  for (let i = 0; i < grayData.length; i++) {
    const val = grayData[i] as number;
    sum += val;
  }
  const mean = sum / grayData.length;

  // Apply adaptive thresholding with local mean
  const thresholded = new Uint8ClampedArray(grayData.length);
  const blockSize = 25; // Size of local region
  const offset = 10; // Constant subtracted from local mean

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Calculate local mean in blockSize x blockSize neighborhood
      let localSum = 0;
      let localCount = 0;

      const startX = Math.max(0, x - blockSize);
      const endX = Math.min(width, x + blockSize);
      const startY = Math.max(0, y - blockSize);
      const endY = Math.min(height, y + blockSize);

      for (let ly = startY; ly < endY; ly++) {
        for (let lx = startX; lx < endX; lx++) {
          const grayVal = grayData[ly * width + lx] as number;
          localSum += grayVal;
          localCount++;
        }
      }

      const localMean = localSum / localCount;
      const threshold = localMean - offset;
      thresholded[y * width + x] =
        (grayData[y * width + x] as number) > threshold ? 255 : 0;
    }
  }

  // Create enhanced image with white background and black text
  const enhancedCanvas = document.createElement("canvas");
  enhancedCanvas.width = width;
  enhancedCanvas.height = height;
  const enhancedCtx = enhancedCanvas.getContext("2d");
  if (!enhancedCtx) return canvas;

  const enhancedImageData = enhancedCtx.createImageData(width, height);
  for (let i = 0; i < thresholded.length; i++) {
    const value = thresholded[i] as number;
    const offset = i * 4;
    // White background, black text
    enhancedImageData.data[offset] = value; // R
    enhancedImageData.data[offset + 1] = value; // G
    enhancedImageData.data[offset + 2] = value; // B
    enhancedImageData.data[offset + 3] = 255; // Alpha
  }

  enhancedCtx.putImageData(enhancedImageData, 0, 0);
  return enhancedCanvas;
}

/**
 * Converts a canvas back to a File for tesseract processing.
 */
function bitmapToFile(
  bitmap: HTMLCanvasElement,
  filename: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    bitmap.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not convert bitmap to blob"));
          return;
        }
        resolve(new File([blob], filename, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.95,
    ); // High quality JPEG
  });
}

/**
 * Post-process OCR text to fix common Kenyan ID formatting issues.
 */
function postProcessOcrText(text: string): string {
  // Kenyan ID specific corrections
  const corrections: [RegExp, string][] = [
    // Common OCR misreadings in Kenyan ID text
    [/0/g, "O"], // Zero often confused with O
    [/1/g, "I"], // One often confused with I
    [/5/g, "S"], // Five often confused with S
    [/\s\s+/g, " "], // Multiple spaces to single
    [/(\d{3})\s{2,}(\d{3})/g, "$1 $2"], // Standardize spacing in ID numbers
  ];

  let processed = text;
  for (const [regex, replacement] of corrections) {
    processed = processed.replace(regex, replacement);
  }

  return processed.trim();
}

function mergeParsed(
  a: ParsedNationalId,
  b: ParsedNationalId,
): ParsedNationalId {
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)),
  };
}

export function JoinWizard({ invite = null }: { invite?: JoinInvite | null }) {
  // On server, always start fresh; on client, check for saved state
  const [step, setStep] = useState<Step>(() => {
    // If they came from an invite, always start fresh
    if (invite) return "capture";
    // Initial render - server side or no saved state
    return "capture";
  });

  // After mount, check for saved state and update step if needed
  useEffect(() => {
    if (invite) return;

    const savedRegistrationId = localStorage.getItem("join_registration_id");
    const hasSavedState = Boolean(savedRegistrationId);

    if (hasSavedState) {
      setStep((prev) => {
        // Only change to start-choice if we're still at capture step
        if (prev === "capture") return "start-choice";
        return prev;
      });
    }
  }, [invite]);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [details, setDetails] = useState<JoinDetails>(() =>
    initialDetails(invite),
  );
  // Which fields the scan filled in, so the review step can mark them as
  // read-off-the-card rather than presenting OCR output and a person's own
  // typing as equally trustworthy.
  const [scanned, setScanned] = useState<Set<ScannedField>>(new Set());
  const [scanReport, setScanReport] = useState<{
    read: number;
    ranOcr: boolean;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  // After mount, restore registration ID from localStorage if not from invite
  useEffect(() => {
    if (invite) return;

    const savedId = localStorage.getItem("join_registration_id");
    if (savedId) {
      setRegistrationId(savedId);
    }
  }, [invite]);
  const [frontDocumentId, setFrontDocumentId] = useState<string | undefined>(
    undefined,
  );
  const [backDocumentId, setBackDocumentId] = useState<string | undefined>(
    undefined,
  );
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [handleCandidates, setHandleCandidates] = useState<string[]>([]);
  const [chosenHandle, setChosenHandle] = useState<string | null>(null);
  const [esoqoId, setEsoqoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Object URLs are created here, once per file, and revoked when that
  // file is replaced or the wizard unmounts — a URL minted during render
  // leaks one per re-render, and the previews outlive several steps.
  const frontPreview = useObjectUrl(frontFile);
  const backPreview = useObjectUrl(backFile);

  function runOcr() {
    if (!frontFile) {
      setError("Take a photo of the front of your ID first");
      return;
    }
    setError(null);
    setProgress(0);
    setStep("extracting");
    start(async () => {
      let read = 0;
      let ranOcr = false;
      try {
        // Two photos share the bar: the front is the first half, the back
        // the second, so it advances once rather than resetting halfway.
        const halves = backFile ? 2 : 1;
        const frontText = await extractText(frontFile, (p) =>
          setProgress(p / halves),
        );
        const backText = backFile
          ? await extractText(backFile, (p) => setProgress(0.5 + p / 2))
          : "";
        ranOcr = true;
        const parsed = mergeParsed(
          parseKenyanIdText(frontText),
          parseKenyanIdText(backText),
        );
        const filled = new Set<string>(filledNationalIdFields(parsed));
        const usable = SCANNED_FIELDS.filter((f) => filled.has(f));
        setDetails((d) => applyParsed(d, parsed));
        setScanned(new Set(usable));
        read = usable.length;
      } catch {
        // OCR failing is never fatal — the form still works, just blank.
        // The review step says which of the two happened rather than
        // leaving someone to wonder why it is empty.
      } finally {
        setScanReport({ read, ranOcr });
        setProgress(1);
        setStep("name");
      }
    });
  }

  function skipToDetails() {
    setError(null);
    setScanReport(null);
    setStep("name");
  }

  function startFresh() {
    // Clear saved state and start over
    localStorage.removeItem("join_registration_id");
    setRegistrationId(null);
    setStep("capture");
    setError(null);
  }

  function resumeRegistration() {
    // Keep saved registration and continue from where they left off
    const savedId = localStorage.getItem("join_registration_id");
    if (savedId) {
      setRegistrationId(savedId);
      // Go to name step since they've already started
      setStep("name");
      setError(null);
    }
  }

  // Whenever registration ID changes, save it (but not if cleared)
  useEffect(() => {
    if (registrationId && typeof window !== "undefined") {
      localStorage.setItem("join_registration_id", registrationId);
    }
  }, [registrationId]);

  function submitDetails() {
    setError(null);
    setFieldError(null);
    setUploadWarning(null);
    start(async () => {
      const res = await actionStartJoin(registrationId, details);
      if (!res.ok) {
        // Set field-specific error if available, otherwise general error
        if (res.field) {
          setFieldError(res.field);
          setError(res.error);
        } else {
          setError(res.error);
        }
        return;
      }
      setRegistrationId(res.data.registrationId);

      // The photos go up now if provided, attached to the registration, and
      // are kept as the scan of record (see saveNationalIdRecord's front/back
      // document ids). Both front and back are now optional — users can
      // complete registration without ID photos.
      const failed: string[] = [];
      if (frontFile) {
        const id = await upload(res.data.registrationId, "front", frontFile);
        if (id) setFrontDocumentId(id);
        else failed.push("front");
      }
      if (backFile) {
        const id = await upload(res.data.registrationId, "back", backFile);
        if (id) setBackDocumentId(id);
        else failed.push("back");
      }
      // If any photos failed to upload, just warn — registration can continue
      if (failed.length > 0) {
        setUploadWarning(
          `We couldn't store ${failed.includes("front") ? "the front photo" : ""}${failed.length === 2 ? " and " : ""}${failed.includes("back") && failed.length === 2 ? "the back photo" : failed.includes("back") ? "the back photo" : ""} of your ID. Everything else is saved — you can add it later from your settings.`,
        );
      }

      const sent = await actionSendJoinOtp(details.msisdn);
      if (!sent.ok) {
        if (sent.field) {
          setFieldError(sent.field);
        }
        setError(sent.error);
        return;
      }
      setStep("otp");
    });
  }

  function verify() {
    if (!registrationId) return;
    setError(null);
    setFieldError(null);
    start(async () => {
      const res = await actionVerifyJoinOtp(
        registrationId,
        details.msisdn,
        code,
      );
      if (!res.ok) {
        if (res.field) {
          setFieldError(res.field);
        }
        setError(res.error);
        return;
      }

      const done = await actionCompleteJoin(registrationId, {
        idNumber: details.idNumber || undefined,
        serialNumber: details.serialNumber || undefined,
        sex: details.sex || undefined,
        districtOfBirth: details.districtOfBirth || undefined,
        dateOfIssue: details.dateOfIssue || undefined,
        frontDocumentId,
        backDocumentId,
        inviteToken: invite?.token,
      });
      if (!done.ok) {
        setError(done.error);
        return;
      }

      // No candidates back (already-issued edge case) skips straight to
      // 'done' with nothing to pick — otherwise the person chooses.
      if (done.data.candidates.length === 0) {
        setStep("done");
        return;
      }
      setHandleCandidates(done.data.candidates);
      setStep("pick-handle");
    });
  }

  function pickHandle(handle: string) {
    if (!registrationId) return;
    setError(null);
    setChosenHandle(handle);
    start(async () => {
      const res = await actionConfirmHandle(registrationId, handle);
      if (!res.ok) {
        setError(res.error);
        setChosenHandle(null);
        return;
      }
      setEsoqoId(res.data.esoqoId);
      setStep("done");
    });
  }

  if (step === "start-choice") {
    return (
      <div style={{ textAlign: "center", paddingTop: "40px" }}>
        <Icon name="info" size={48} style={{ marginBottom: "20px" }} />
        <h2 style={{ marginTop: 12, marginBottom: 6 }}>Resume your signup?</h2>
        <p
          className="sub"
          style={{ marginBottom: 24, maxWidth: "400px", margin: "0 auto 24px" }}
        >
          We found a registration you started before. Do you want to continue
          from where you left off, or start fresh?
        </p>
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn btn-p"
            onClick={resumeRegistration}
            style={{ minWidth: "150px" }}
          >
            <Icon name="arrow-right" size={16} /> Resume
          </button>
          <button
            type="button"
            className="btn btn-o"
            onClick={startFresh}
            style={{ minWidth: "150px" }}
          >
            <Icon name="refresh" size={16} /> Start fresh
          </button>
        </div>
      </div>
    );
  }

  if (step === "capture" || step === "extracting") {
    const busy = step === "extracting";
    return (
      <div>
        <Steps step={step} />
        {invite && <InviteBanner invite={invite} />}

        <p className="sub" style={{ marginBottom: 14 }}>
          You can scan the front and back of your national ID and we&apos;ll
          read the details for you, or skip this step and type them in yourself.
          Both photos and ID details are optional.
        </p>

        <div className="grid2" style={{ gap: 14, marginBottom: 14 }}>
          <IdCardScanner
            label="Front of your ID"
            disabled={busy}
            hint="Names, date of birth and ID number are on this side"
            file={frontFile}
            previewUrl={frontPreview}
            onCapture={setFrontFile}
            onClear={() => setFrontFile(null)}
          />
          <IdCardScanner
            label="Back of your ID"
            optional
            disabled={busy}
            hint="Serial number and date of issue live here"
            file={backFile}
            previewUrl={backPreview}
            onCapture={setBackFile}
            onClear={() => setBackFile(null)}
          />
        </div>

        <div className="note n-blue" style={{ marginBottom: 16 }}>
          <Icon name="lock" size={18} />
          <div>
            <strong>Your photos are kept securely if you provide them</strong>
            <p style={{ fontSize: ".86rem" }}>
              If you upload ID photos, both sides are stored with your Esoqo
              record as your scanned ID, and the ID number itself is encrypted.
              They are held to confirm who you are &mdash; no other member,
              group or shop is ever shown them.
            </p>
          </div>
        </div>

        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }}>
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}

        {busy ? (
          <div className="joinocr">
            <p className="joinocr-lab">
              <Icon name="loader" size={15} className="spin" /> Reading your ID…
            </p>
            <div
              className="joinocr-bar"
              role="progressbar"
              aria-label="Reading your ID"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span
                style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
              />
            </div>
            <p className="hint" style={{ margin: 0 }}>
              This happens on your phone, not on our servers, so it can take a
              few seconds.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-p"
              style={{ width: "100%" }}
              disabled={!frontFile}
              onClick={runOcr}
            >
              Read my ID <Icon name="arrow-right" size={16} />
            </button>
            <button
              type="button"
              className="btn btn-o"
              style={{ width: "100%", marginTop: 8 }}
              onClick={skipToDetails}
            >
              Skip — I&apos;ll type it in myself
            </button>
          </>
        )}
      </div>
    );
  }

  // Helper function to validate and move to next step
  function validateAndNext(
    currentStep: Step,
    nextStep: Step,
    requiredFields: Array<keyof JoinDetails>,
  ) {
    const problems = new Map<keyof JoinDetails, string>();

    for (const field of requiredFields) {
      const value = String(details[field] ?? "");
      if (field === "msisdn") {
        if (value.replace(/\D/g, "").length < 10) {
          problems.set(field, "Add a valid phone number");
        }
      } else if (field === "dateOfBirth") {
        if (!value.trim()) {
          problems.set(field, "Add your date of birth");
        } else {
          // Age validation
          const dob = new Date(value);
          const today = new Date();
          const age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          const dayDiff = today.getDate() - dob.getDate();
          const exactAge =
            monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? age - 1 : age;

          if (exactAge < 18) {
            problems.set(
              field,
              "You must be at least 18 years old to register",
            );
          }
        }
      } else if (!value.trim()) {
        const fieldNames: Record<string, string> = {
          firstName: "Add your first name",
          surname: "Add your surname",
          county: "Choose your county",
        };
        problems.set(field, fieldNames[field] || `Add ${field}`);
      }
    }

    if (problems.size > 0) {
      const firstProblem = [...problems][0];
      if (firstProblem) {
        setError(firstProblem[1]);
        setFieldError(firstProblem[0]);
      }
      return;
    }

    setError(null);
    setFieldError(null);
    setStep(nextStep);
  }

  // Step 1: Name fields
  if (step === "name") {
    return (
      <>
        <Steps step={step} />
        {invite && <InviteBanner invite={invite} />}

        {(frontPreview || backPreview) && (
          <div className="joinphotos" style={{ marginBottom: 20 }}>
            <button
              type="button"
              className="joinphotos-toggle"
              onClick={() => setStep("capture")}
            >
              <Icon name="chevron-right" size={14} />
              View ID photos
            </button>
          </div>
        )}

        <h2 style={{ marginTop: 12, marginBottom: 6 }}>Your name</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          As it appears on your ID, so the two match later.
        </p>

        <div className="fld">
          <label className="lab" htmlFor="j-first">
            <Icon name="user" size={15} />
            First name
            {scanned.has("firstName") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <input
            className="inp"
            id="j-first"
            value={details.firstName}
            autoComplete="given-name"
            onChange={(e) =>
              setDetails({ ...details, firstName: e.target.value })
            }
          />
        </div>

        <div className="fld">
          <label className="lab" htmlFor="j-middle">
            <Icon name="user" size={15} />
            Middle name
            <span className="opt">optional</span>
            {scanned.has("middleName") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <input
            className="inp"
            id="j-middle"
            value={details.middleName ?? ""}
            autoComplete="additional-name"
            onChange={(e) =>
              setDetails({ ...details, middleName: e.target.value })
            }
          />
        </div>

        <div className="fld">
          <label className="lab" htmlFor="j-surname">
            <Icon name="user" size={15} />
            Surname
            {scanned.has("surname") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <input
            className="inp"
            id="j-surname"
            value={details.surname}
            autoComplete="family-name"
            onChange={(e) =>
              setDetails({ ...details, surname: e.target.value })
            }
          />
        </div>

        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-p"
          style={{ width: "100%" }}
          onClick={() =>
            validateAndNext("name", "contact", ["firstName", "surname"])
          }
        >
          Next <Icon name="arrow-right" size={16} />
        </button>
      </>
    );
  }

  // Step 2: Contact fields
  if (step === "contact") {
    return (
      <>
        <Steps step={step} />
        <h2 style={{ marginTop: 12, marginBottom: 6 }}>How we reach you</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          Your phone number is how you sign in to Esoqo, so this is the one to
          get right.
        </p>

        <div className="fld">
          <label className="lab" htmlFor="j-msisdn">
            <Icon name="phone" size={15} />
            Phone number
          </label>
          <input
            className="inp mono"
            id="j-msisdn"
            value={details.msisdn}
            inputMode="tel"
            autoComplete="tel"
            onChange={(e) => setDetails({ ...details, msisdn: e.target.value })}
          />
          <p className="hint">
            We'll text a six-digit code here to confirm it's you.
          </p>
        </div>

        {invite && invite.msisdn && details.msisdn !== invite.msisdn && (
          <div className="note n-red" style={{ marginBottom: 15 }}>
            <Icon name="alert-circle" size={18} />
            <div>
              <strong>
                Use your invited phone number to keep your membership
              </strong>
              <p>
                Your place in {invite.orgName} is held for {invite.msisdn}. You
                must sign up on that same number, or ask an officer to send you
                a new invite for this one.
              </p>
            </div>
          </div>
        )}

        <div className="fld">
          <label className="lab" htmlFor="j-email">
            <Icon name="mail" size={15} />
            Email
            <span className="opt">optional</span>
          </label>
          <input
            className="inp"
            id="j-email"
            type="email"
            value={details.email ?? ""}
            autoComplete="email"
            onChange={(e) => setDetails({ ...details, email: e.target.value })}
          />
          <p className="hint">
            Only used for receipts and notices. You can add it later.
          </p>
        </div>

        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn btn-o"
            onClick={() => setStep("name")}
            style={{ flex: "0 0 auto" }}
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-p"
            style={{ flex: 1 }}
            onClick={() => validateAndNext("contact", "location", ["msisdn"])}
          >
            Next <Icon name="arrow-right" size={16} />
          </button>
        </div>
      </>
    );
  }

  // Step 3: Location fields
  if (step === "location") {
    return (
      <>
        <Steps step={step} />
        <h2 style={{ marginTop: 12, marginBottom: 6 }}>Where you are</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          This is how we show you prices and groups near you.
        </p>

        <div className="fld">
          <label className="lab" htmlFor="j-county">
            <Icon name="map" size={15} />
            County
            {scanned.has("county") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <select
            className="inp"
            id="j-county"
            value={details.county}
            onChange={(e) => setDetails({ ...details, county: e.target.value })}
          >
            <option value="">Choose…</option>
            <option value="BARINGO">Baringo</option>
            <option value="BOMET">Bomet</option>
            <option value="BUNGOMA">Bungoma</option>
            <option value="BUSIA">Busia</option>
            <option value="ELGEYO_MARAKWET">Elgeyo-Marakwet</option>
            <option value="EMBU">Embu</option>
            <option value="GARISSA">Garissa</option>
            <option value="HOMA_BAY">Homa Bay</option>
            <option value="ISIOLO">Isiolo</option>
            <option value="KAJIADO">Kajiado</option>
            <option value="KAKAMEGA">Kakamega</option>
            <option value="KERICHO">Kericho</option>
            <option value="KIAMBU">Kiambu</option>
            <option value="KILIFI">Kilifi</option>
            <option value="KIRINYAGA">Kirinyaga</option>
            <option value="KISII">Kisii</option>
            <option value="KISUMU">Kisumu</option>
            <option value="KITUI">Kitui</option>
            <option value="KWALE">Kwale</option>
            <option value="LAIKIPIA">Laikipia</option>
            <option value="LAMU">Lamu</option>
            <option value="MACHAKOS">Machakos</option>
            <option value="MAKUENI">Makueni</option>
            <option value="MANDERA">Mandera</option>
            <option value="MARSABIT">Marsabit</option>
            <option value="MERU">Meru</option>
            <option value="MIGORI">Migori</option>
            <option value="MOMBASA">Mombasa</option>
            <option value="MURANGA">Murang'a</option>
            <option value="NAIROBI">Nairobi</option>
            <option value="NAKURU">Nakuru</option>
            <option value="NANDI">Nandi</option>
            <option value="NAROK">Narok</option>
            <option value="NYAMIRA">Nyamira</option>
            <option value="NYANDARUA">Nyandarua</option>
            <option value="NYERI">Nyeri</option>
            <option value="SAMBURU">Samburu</option>
            <option value="SIAYA">Siaya</option>
            <option value="TAITA_TAVETA">Taita-Taveta</option>
            <option value="TANA_RIVER">Tana River</option>
            <option value="THARAKA_NITHI">Tharaka-Nithi</option>
            <option value="TRANS_NZOIA">Trans Nzoia</option>
            <option value="TURKANA">Turkana</option>
            <option value="UASIN_GISHU">Uasin Gishu</option>
            <option value="VIHIGA">Vihiga</option>
            <option value="WAJIR">Wajir</option>
            <option value="WEST_POKOT">West Pokot</option>
          </select>
          <p className="hint">
            This is on your national ID, where it says "District of Birth."
          </p>
        </div>

        <div className="fld">
          <label className="lab" htmlFor="j-ward">
            <Icon name="map" size={15} />
            Ward
            <span className="opt">optional</span>
          </label>
          <input
            className="inp"
            id="j-ward"
            value={details.ward ?? ""}
            onChange={(e) => setDetails({ ...details, ward: e.target.value })}
          />
          <p className="hint">
            Your ward or nearest town — e.g. "Kileleshwa" or "Eldoret West"
          </p>
        </div>

        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn btn-o"
            onClick={() => setStep("contact")}
            style={{ flex: "0 0 auto" }}
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-p"
            style={{ flex: 1 }}
            onClick={() =>
              validateAndNext("location", "id-details", ["county"])
            }
          >
            Next <Icon name="arrow-right" size={16} />
          </button>
        </div>
      </>
    );
  }

  // Step 4: ID details
  if (step === "id-details") {
    return (
      <>
        <Steps step={step} />
        <h2 style={{ marginTop: 12, marginBottom: 6 }}>From your ID card</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          {scanReport && scanReport.read > 0
            ? "Read off the photo you took — worth a glance, since a scan gets it close rather than right."
            : "Most fields are optional, but filling them in now saves you proving who you are later."}
        </p>

        <div className="grid2" style={{ gap: 14, marginBottom: 14 }}>
          <div className="fld">
            <label className="lab" htmlFor="j-dob">
              <Icon name="calendar" size={15} />
              Date of birth
              {scanned.has("dateOfBirth") && (
                <span className="scanpill" style={{ marginLeft: 6 }}>
                  <Icon name="document" size={11} /> from your ID
                </span>
              )}
            </label>
            <input
              className="inp"
              id="j-dob"
              type="date"
              value={details.dateOfBirth ?? ""}
              onChange={(e) =>
                setDetails({ ...details, dateOfBirth: e.target.value })
              }
              max={new Date().toISOString().split("T")[0]}
            />
            <p className="hint">
              You must be at least 18 years old to register
            </p>
          </div>

          <div className="fld">
            <label className="lab" htmlFor="j-sex">
              <Icon name="user" size={15} />
              Sex
              <span className="opt">optional</span>
              {scanned.has("sex") && (
                <span className="scanpill" style={{ marginLeft: 6 }}>
                  <Icon name="document" size={11} /> from your ID
                </span>
              )}
            </label>
            <select
              className="inp"
              id="j-sex"
              value={details.sex ?? ""}
              onChange={(e) => setDetails({ ...details, sex: e.target.value })}
            >
              <option value="">Choose…</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </div>
        </div>

        <div className="fld">
          <label className="lab" htmlFor="j-idnum">
            <Icon name="document" size={15} />
            ID number
            <span className="opt">optional</span>
            {scanned.has("idNumber") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <input
            className="inp mono"
            id="j-idnum"
            value={details.idNumber ?? ""}
            inputMode="numeric"
            onChange={(e) =>
              setDetails({ ...details, idNumber: e.target.value })
            }
          />
          {scanned.has("idNumber") && (
            <p className="hint">
              Worth checking digit by digit — this is the one field a misread
              number is hardest to notice later.
            </p>
          )}
        </div>

        <div className="grid2" style={{ gap: 14, marginBottom: 14 }}>
          <div className="fld">
            <label className="lab" htmlFor="j-serial">
              <Icon name="document" size={15} />
              Serial number
              <span className="opt">optional</span>
              {scanned.has("serialNumber") && (
                <span className="scanpill" style={{ marginLeft: 6 }}>
                  <Icon name="document" size={11} /> from your ID
                </span>
              )}
            </label>
            <input
              className="inp mono"
              id="j-serial"
              value={details.serialNumber ?? ""}
              inputMode="numeric"
              onChange={(e) =>
                setDetails({ ...details, serialNumber: e.target.value })
              }
            />
          </div>

          <div className="fld">
            <label className="lab" htmlFor="j-issue">
              <Icon name="calendar" size={15} />
              Date of issue
              <span className="opt">optional</span>
              {scanned.has("dateOfIssue") && (
                <span className="scanpill" style={{ marginLeft: 6 }}>
                  <Icon name="document" size={11} /> from your ID
                </span>
              )}
            </label>
            <input
              className="inp"
              id="j-issue"
              type="date"
              value={details.dateOfIssue ?? ""}
              onChange={(e) =>
                setDetails({ ...details, dateOfIssue: e.target.value })
              }
            />
          </div>
        </div>

        <div className="fld">
          <label className="lab" htmlFor="j-district">
            <Icon name="map" size={15} />
            District of birth
            <span className="opt">optional</span>
            {scanned.has("districtOfBirth") && (
              <span className="scanpill" style={{ marginLeft: 6 }}>
                <Icon name="document" size={11} /> from your ID
              </span>
            )}
          </label>
          <input
            className="inp"
            id="j-district"
            value={details.districtOfBirth ?? ""}
            onChange={(e) =>
              setDetails({ ...details, districtOfBirth: e.target.value })
            }
          />
        </div>

        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn btn-o"
            onClick={() => setStep("location")}
            style={{ flex: "0 0 auto" }}
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <button
            type="button"
            className="btn btn-p"
            style={{ flex: 1 }}
            disabled={pending}
            onClick={() => {
              // Validate date of birth is required and user is 18+
              if (!details.dateOfBirth) {
                setError("Date of birth is required");
                setFieldError("dateOfBirth");
                return;
              }

              const dob = new Date(details.dateOfBirth);
              const today = new Date();
              const age = today.getFullYear() - dob.getFullYear();
              const monthDiff = today.getMonth() - dob.getMonth();
              const dayDiff = today.getDate() - dob.getDate();
              const exactAge =
                monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)
                  ? age - 1
                  : age;

              if (exactAge < 18) {
                setError("You must be at least 18 years old to register");
                setFieldError("dateOfBirth");
                return;
              }

              setError(null);
              setFieldError(null);
              submitDetails();
            }}
          >
            {pending ? "Sending code…" : "Send verification code"}{" "}
            <Icon name="send" size={16} />
          </button>
        </div>
      </>
    );
  }

  if (step === "otp") {
    return (
      <div>
        <Steps step={step} />
        <p className="sub" style={{ marginBottom: 14 }}>
          Last step. We sent a six-digit code to{" "}
          <strong className="mono">{details.msisdn}</strong> &mdash;{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setError(null);
              setStep("contact");
            }}
          >
            not your number?
          </button>
        </p>
        {uploadWarning && (
          <div className="note n-amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={18} />
            <div>
              <p>{uploadWarning}</p>
            </div>
          </div>
        )}
        <div className="fld">
          <label className="lab" htmlFor="join-code">
            <Icon name="keypad" size={15} />
            Code
          </label>
          <input
            className="inp mono joincode"
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <p className="hint">
            It can take a minute to arrive. Didn&apos;t get it?{" "}
            <button
              type="button"
              className="linkish"
              disabled={pending}
              onClick={() => {
                setError(null);
                setCode("");
                start(async () => {
                  const sent = await actionSendJoinOtp(details.msisdn);
                  if (!sent.ok) {
                    setError(sent.error);
                  }
                });
              }}
            >
              Send again
            </button>
          </p>
        </div>
        {error && (
          <div className="note n-red" style={{ marginBottom: 16 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          className="btn btn-p"
          style={{ width: "100%" }}
          disabled={pending || code.trim().length !== 6}
          onClick={verify}
        >
          {pending ? "Confirming…" : "Confirm & join"}{" "}
          <Icon name="check" size={16} />
        </button>
      </div>
    );
  }

  if (step === "pick-handle") {
    return (
      <div>
        <Steps step={step} />
        <h2 style={{ marginTop: 12 }}>Pick your esoqo ID</h2>
        <p className="sub" style={{ marginBottom: 14 }}>
          This is the handle people use to pay or find you. Choose one — it
          can&apos;t be changed later.
        </p>
        <div role="radiogroup" aria-label="Candidate esoqo IDs">
          {handleCandidates.map((handle) => (
            <button
              key={handle}
              type="button"
              role="radio"
              aria-checked={chosenHandle === handle}
              disabled={pending}
              onClick={() => pickHandle(handle)}
              className="btn"
              style={{
                width: "100%",
                textAlign: "left",
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                className="mono"
                style={{ fontSize: "1.1rem", fontWeight: 700 }}
              >
                {handle}
              </span>
              {chosenHandle === handle && pending ? (
                <Icon name="loader" size={16} />
              ) : (
                <Icon name="arrow-right" size={16} />
              )}
            </button>
          ))}
        </div>
        {error && (
          <div className="note n-red" style={{ marginTop: 8 }} role="alert">
            <div>
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center" }}>
      <Icon name="check-circle" size={40} />
      <h2 style={{ marginTop: 12 }}>Welcome to Esoqo</h2>
      <p className="lead" style={{ marginTop: 6 }}>
        Your esoqo ID is
      </p>
      <p
        className="mono"
        style={{ fontSize: "1.4rem", fontWeight: 700, margin: "8px 0 18px" }}
      >
        {esoqoId}
      </p>
      {invite && (
        <p className="sub" style={{ margin: "0 0 18px" }}>
          {invite.joinFeeKes > 0
            ? `Your place in ${invite.orgName} is held. Set a PIN, then pay the KES ${invite.joinFeeKes.toLocaleString("en-KE")} join fee to activate it.`
            : `You are a member of ${invite.orgName} — it will be waiting once you set a PIN.`}
        </p>
      )}
      <a
        className="btn btn-p"
        style={{ width: "100%" }}
        href={`/signin/set-pin?msisdn=${encodeURIComponent(details.msisdn)}`}
      >
        Continue — set your PIN <Icon name="arrow-right" size={16} />
      </a>
    </div>
  );
}

/**
 * Where you are and how much is left.
 *
 * Three steps and a finish. Worth the space precisely because the middle
 * step is long: someone looking at a thirteen-field form with no idea
 * whether two more like it are coming will reasonably decide to do this
 * later, and "later" is how a signup is abandoned. Naming the steps also
 * sets the expectation that the ID scan is *not* the whole thing — the
 * code on their phone is, and that arrives at the end.
 */
const WIZARD_STEPS: Array<{ key: Step; label: string }> = [
  { key: "capture", label: "Scan" },
  { key: "name", label: "Name" },
  { key: "contact", label: "Contact" },
  { key: "location", label: "Location" },
  { key: "id-details", label: "Details" },
  { key: "otp", label: "Confirm" },
];

function Steps({ step }: { step: Step }) {
  // 'extracting' is a state of the capture step, not a step of its own —
  // a progress bar that advanced while OCR ran would promise a stage that
  // does not exist.
  // 'start-choice' is also not shown in the progress bar — it's a pre-flow choice
  const current =
    step === "extracting"
      ? "capture"
      : step === "start-choice"
        ? "capture"
        : step;
  const index = WIZARD_STEPS.findIndex((s) => s.key === current);
  const position =
    current === "done" || current === "pick-handle"
      ? WIZARD_STEPS.length
      : index;

  return (
    <ol
      className="jsteps"
      aria-label={`Step ${position + 1} of ${WIZARD_STEPS.length}`}
    >
      {WIZARD_STEPS.map((s, i) => {
        const state = i < position ? "done" : i === position ? "on" : "todo";
        return (
          <li key={s.key} className={state}>
            <span className="bar" />
            <span className="jsteps-lab">
              {state === "done" && <Icon name="check" size={11} />}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function InviteBanner({ invite }: { invite: JoinInvite }) {
  return (
    <div className="note n-green" style={{ marginBottom: 16 }}>
      <Icon name="users" size={18} />
      <div>
        <strong>
          {invite.inviterName ?? "An officer"} added you to {invite.orgName}
        </strong>
        <p>
          We already have your name and number from them, so they&apos;re filled
          in below.
          {invite.joinFeeKes > 0 && (
            <>
              {" "}
              The group asks for a one-time KES{" "}
              {invite.joinFeeKes.toLocaleString("en-KE")} join fee, which you
              can pay once you&apos;re in.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** An invite already knows who this is — starting them on a blank form
 *  asks for what the officer typed in an hour ago. The phone number
 *  matters most: it is what ties this signup back to the membership
 *  waiting for them (completeRegistration matches an existing Person on
 *  msisdn), which is why DetailsForm warns if it gets changed. */
function initialDetails(invite: JoinInvite | null): JoinDetails {
  if (!invite) return EMPTY_DETAILS;
  return {
    ...EMPTY_DETAILS,
    firstName: invite.firstName ?? "",
    middleName: invite.middleName ?? "",
    surname: invite.surname ?? "",
    msisdn: invite.msisdn ?? EMPTY_DETAILS.msisdn,
    email: invite.email ?? "",
  };
}

/** Pours a scan into the form, leaving any field the card had nothing for
 *  exactly as it was — so a re-scan of a better-lit photo tops up what was
 *  missing instead of blanking what the first pass got right. */
function applyParsed(d: JoinDetails, parsed: ParsedNationalId): JoinDetails {
  return {
    ...d,
    firstName: parsed.firstName ?? d.firstName,
    middleName: parsed.middleName ?? d.middleName,
    surname: parsed.surname ?? d.surname,
    dateOfBirth: parsed.dateOfBirth ?? d.dateOfBirth,
    sex: parsed.sex ?? d.sex,
    county: parsed.county ?? d.county,
    districtOfBirth: parsed.districtOfBirth ?? d.districtOfBirth,
    idNumber: parsed.idNumber ?? d.idNumber,
    serialNumber: parsed.serialNumber ?? d.serialNumber,
    dateOfIssue: parsed.dateOfIssue ?? d.dateOfIssue,
  };
}

async function upload(
  registrationId: string,
  side: "front" | "back",
  file: File,
): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.set("registrationId", registrationId);
    fd.set("side", side);
    fd.set("file", file);
    const up = await actionUploadJoinDocument(fd);
    return up.ok ? up.docId : null;
  } catch {
    return null;
  }
}

/** One object URL per File, revoked when the File changes or on unmount. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
