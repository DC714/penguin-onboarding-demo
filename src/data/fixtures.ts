import { makeNpi } from "@/lib/npi";

/** Everything here is synthetic. "Northwind Health Plan" is a fictional payer. */

export const NPI = {
  park: makeNpi("123456789"),
  okafor: makeNpi("234567890"),
  tran: makeNpi("345678901"),
};
// Dr. Tran's record arrives with two digits transposed, so the check digit fails.
const tranBad = NPI.tran.slice(0, 3) + NPI.tran[4] + NPI.tran[3] + NPI.tran.slice(5);

/** Stand-in for an NPPES-style provider directory lookup. */
export const NPI_DIRECTORY: Record<string, string> = {
  "Samuel Okafor": NPI.okafor,
  "Linh Tran": NPI.tran,
};

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export const NOTES: Record<string, string> = {
  "AUTH-1001":
    "62 y/o with 8 weeks of right leg pain radiating below the knee. Failed 8 weeks of physical therapy and NSAIDs. Exam: right L5 radiculopathy, EHL strength 4/5, positive straight leg raise. No cauda equina symptoms.",
  "AUTH-1002":
    "Low back pain for 3 weeks after lifting. Has not started physical therapy. Neuro exam normal, strength 5/5 throughout.",
  "AUTH-1003":
    "Radicular pain down the left leg for several weeks. Has tried some physical therapy and ibuprofen. Exam notable for diminished left ankle reflex.",
  "AUTH-1004":
    "58 y/o with 10 weeks of left leg numbness and pain. Completed 8 weeks of physical therapy and NSAIDs without relief. Exam: left foot dorsiflexion weakness 4/5.",
  "AUTH-1005":
    "34 y/o with 12 weeks of lumbar radicular pain. Completed 10 weeks of physical therapy and NSAIDs. Exam: right S1 radiculopathy, decreased Achilles reflex.",
  "AUTH-1006":
    "36 y/o with 9 weeks of low back and left leg pain. Completed 9 weeks of PT and NSAIDs. Exam: left EHL weakness 4/5.",
};

function patient(id: string, family: string, given: string[], dob: string, zip: string, memberId: string) {
  return {
    resource: {
      resourceType: "Patient",
      id,
      identifier: [{ system: "urn:northwind:member-id", value: memberId }],
      name: [{ family, given }],
      birthDate: dob,
      address: [{ postalCode: zip }],
    },
  };
}

function practitioner(id: string, family: string, given: string, npi: string | null, specialty: string) {
  return {
    resource: {
      resourceType: "Practitioner",
      id,
      identifier: npi ? [{ system: "http://hl7.org/fhir/sid/us-npi", value: npi }] : [],
      name: [{ family, given: [given] }],
      qualification: [{ code: { text: specialty } }],
    },
  };
}

function serviceRequest(authId: string, memberId: string, pracId: string, icd10: string) {
  return {
    resource: {
      resourceType: "ServiceRequest",
      id: authId,
      status: "active",
      intent: "order",
      code: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "72148", display: "MRI lumbar spine w/o contrast" }] },
      subject: { identifier: { system: "urn:northwind:member-id", value: memberId } },
      requester: { reference: `Practitioner/${pracId}` },
      reasonCode: [{ coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: icd10 }] }],
      supportingInfo: [
        { reference: `DocumentReference/doc-${authId}` },
      ],
    },
  };
}

function docRef(authId: string) {
  return {
    resource: {
      resourceType: "DocumentReference",
      id: `doc-${authId}`,
      status: "current",
      content: [{ attachment: { contentType: "text/plain", data: b64(NOTES[authId]) } }],
    },
  };
}

export const FHIR_BUNDLE = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    patient("pat-1", "Alvarez", ["Maria", "L"], "1968-03-14", "33781", "NHP100001"),
    patient("pat-2", "O'Connor", ["James", "T"], "1955-11-02", "33701", "NHP100002"),
    patient("pat-3", "Raman", ["Priya"], "1979-07-23", "33713", "NHP100003"),
    patient("pat-4", "Chen", ["Robert"], "1962-01-30", "33710", "NHP100004"),
    practitioner("prac-1", "Park", "Elena", NPI.park, "Physical Medicine & Rehabilitation"),
    practitioner("prac-2", "Okafor", "Samuel", null, "Orthopedic Surgery"),
    practitioner("prac-3", "Tran", "Linh", tranBad, "Neurology"),
    serviceRequest("AUTH-1001", "NHP100001", "prac-1", "M54.16"),
    serviceRequest("AUTH-1002", "NHP100002", "prac-1", "M54.50"),
    serviceRequest("AUTH-1003", "NHP100003", "prac-1", "M54.16"),
    serviceRequest("AUTH-1004", "NHP100004", "prac-1", "M54.16"),
    serviceRequest("AUTH-1005", "NHP100005", "prac-3", "M54.17"),
    serviceRequest("AUTH-1006", "NHP100006", "prac-2", "M54.16"),
    ...["AUTH-1001", "AUTH-1002", "AUTH-1003", "AUTH-1004", "AUTH-1005", "AUTH-1006"].map(docRef),
  ],
};

/** HL7 v2 ADT^A08 member updates from the plan's legacy enrollment system. */
export const HL7_MESSAGES = [
  "MSH|^~\\&|ENROLL|NORTHWIND|MPI|NORTHWIND|20261001||ADT^A08|MSG001|P|2.5\rPID|1||||ALVAREZ^MARIA^LUZ||19680314|F|||88 BAYSHORE DR^^ST PETERSBURG^FL^33781",
  "MSH|^~\\&|ENROLL|NORTHWIND|MPI|NORTHWIND|20261001||ADT^A08|MSG002|P|2.5\rPID|1||nhp-100002||OCONNOR^JIM||19551102|M|||14 CENTRAL AVE^^ST PETERSBURG^FL^33701",
  "MSH|^~\\&|ENROLL|NORTHWIND|MPI|NORTHWIND|20261001||ADT^A08|MSG003|P|2.5\rPID|1||NHP100005||WHITFIELD^DANA||19900509|F|||402 2ND ST N^^ST PETERSBURG^FL^33704",
  "MSH|^~\\&|ENROLL|NORTHWIND|MPI|NORTHWIND|20261001||ADT^A08|MSG004|P|2.5\rPID|1||NHP100006||CHEN^ROBERT||19880917|M|||9 PINE ST^^PINELLAS PARK^FL^33781",
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Claims export from the plan's adjudication system. */
export const CLAIMS_CSV = [
  "claim_id,member_id,npi,cpt,icd10,service_date",
  `C-9001,NHP100004,${NPI.park},72148,M54.16,${daysAgo(150)}`,
  `C-9002,NHP100001,${NPI.park},99213,M54.16,${daysAgo(80)}`,
  `C-9003,NHP100099,${NPI.park},72148,J20.9,${daysAgo(40)}`,
  `C-9004,NHP100005,${NPI.tran},99214,54.16,${daysAgo(20)}`,
].join("\n");

export const POLICY = {
  id: "NHP-IMG-014",
  title: "MRI Lumbar Spine without Contrast (CPT 72148)",
  criteria: [
    { id: "C1", label: "At least 6 weeks of documented conservative therapy (PT, NSAIDs, or medication)" },
    { id: "C2", label: "Objective neurological deficit or radiculopathy on exam" },
    { id: "C3", label: "No lumbar spine imaging claim in the prior 12 months" },
    { id: "C4", label: "Ordering provider has a valid NPI on file" },
  ],
};
