export function beginCreditRequest(requestRef) {
  const requestId = requestRef.current + 1;
  requestRef.current = requestId;
  return requestId;
}

export function isCurrentCreditRequest(requestRef, requestId) {
  return requestRef.current === requestId;
}

export function invalidateCreditRequest(requestRef) {
  requestRef.current += 1;
}
