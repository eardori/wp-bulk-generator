"use client";

import { useEffect, useCallback, useRef } from "react";

const STORAGE_PREFIX = "wpbulk_state_";

/**
 * 작업 중인 페이지에서:
 * 1. sessionStorage에 상태를 자동 저장
 * 2. 페이지 복귀 시 상태를 자동 복원
 * 3. 작업 중 탭 닫기/새로고침 시 경고 표시
 * 4. 다른 메뉴 이동 시 경고 표시
 */

type UseSessionPersistOptions<T> = {
  /** 고유 키 (예: "deploy", "content") */
  key: string;
  /** 현재 상태 */
  state: T;
  /** 상태 복원 함수 */
  onRestore: (saved: T) => void;
  /** 작업 중인지 판별 */
  isWorking: boolean;
  /** 작업 완료/초기 상태인지 (완료 시 저장 데이터 삭제) */
  isIdle: boolean;
};

export function useSessionPersist<T>({
  key,
  state,
  onRestore,
  isWorking,
  isIdle,
}: UseSessionPersistOptions<T>) {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const restoredRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // 1. 마운트 시 저장된 상태 복원
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as T;
        onRestoreRef.current(parsed);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // 2. 상태 변경 시 sessionStorage에 저장 (throttle)
  useEffect(() => {
    if (isIdle) {
      sessionStorage.removeItem(storageKey);
      return;
    }

    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        // storage full — ignore
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [state, storageKey, isIdle]);

  // 3. 탭 닫기/새로고침 시 경고
  useEffect(() => {
    if (!isWorking) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isWorking]);

  // 저장 데이터 수동 삭제
  const clearSaved = useCallback(() => {
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  return { clearSaved };
}
