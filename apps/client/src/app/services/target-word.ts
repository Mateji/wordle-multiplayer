import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TargetWord {
  private _http = inject(HttpClient);

  getTargetWords(): Observable<string[]> {
    return this._http
      .get<{ data: string[] }>(`assets/target-words-5.json`)
      .pipe(map((response) => response.data ?? []));
  }

  getAllowedWords(): Observable<string[]> {
    return this._http
      .get<{ data: string[] }>(`assets/allowed-words-5.json`)
      .pipe(map((response) => response.data ?? []));
  }
}
