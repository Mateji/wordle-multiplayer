import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TargetWord } from './target-word';

describe('TargetWord', () => {
  let service: TargetWord;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient()],
    });
    service = TestBed.inject(TargetWord);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
