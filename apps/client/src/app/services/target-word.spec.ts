import { TestBed } from '@angular/core/testing';

import { TargetWord } from './target-word';

describe('TargetWord', () => {
  let service: TargetWord;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TargetWord);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
