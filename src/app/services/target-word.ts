import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class TargetWord {
    private _http = inject(HttpClient);

    getTargetWords(): Observable<string[]> {
        return this._http.get<string[]>(`assets/target-words.json`);
    }
}
