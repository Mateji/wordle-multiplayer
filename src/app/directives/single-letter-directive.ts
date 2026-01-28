import { Directive, ElementRef, HostBinding, HostListener } from '@angular/core';

@Directive({
    selector: '[appSingleLetter]',
})
export class SingleLetterDirective {
    @HostBinding('attr.maxlength') maxlength = 1;

    constructor(private readonly elementRef: ElementRef<HTMLInputElement>) { }

    @HostListener('keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        const input = this.elementRef.nativeElement;

        // Navigation
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.focusPreviousInput();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.focusNextInput();
            return;
        }

        // Backspace handling
        if (event.key === 'Backspace') {
            event.preventDefault();
            if (input.value) {
                input.value = '';
            } else {
                const prev = this.getPreviousInput();
                if (prev) {
                    prev.value = '';
                    prev.focus();
                }
            }
            return;
        }

        // Allow navigation/editing keys
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key.length !== 1) return;

        // Only handle letters
        if (!/^[a-z]$/i.test(event.key)) {
            event.preventDefault();
            return;
        }

        // Overwrite current value and advance
        event.preventDefault();
        const nextValue = event.key.toLocaleUpperCase();
        if (input.value !== nextValue) {
            input.value = nextValue;
        }
        this.focusNextInput();
    }

    @HostListener('input')
    onInput(): void {
        const input = this.elementRef.nativeElement;
        const cleaned = input.value.replace(/[^a-z]/gi, '');
        const nextValue = cleaned.slice(0, 1).toUpperCase();

        if (input.value !== nextValue) {
            input.value = nextValue;
        }

        if (nextValue) {
            this.focusNextInput();
        }
    }

    private focusNextInput(): void {
        const input = this.elementRef.nativeElement;
        const container = input.closest('.letter-container');
        if (!container) return;

        const inputs = Array.from(
            container.querySelectorAll<HTMLInputElement>('input.letter')
        ).filter((el) => !el.disabled);

        const index = inputs.indexOf(input);
        if (index >= 0 && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    }

    private focusPreviousInput(): void {
        const input = this.elementRef.nativeElement;
        const container = input.closest('.letter-container');
        if (!container) return;

        const inputs = Array.from(
            container.querySelectorAll<HTMLInputElement>('input.letter')
        ).filter((el) => !el.disabled);

        const index = inputs.indexOf(input);
        if (index > 0) {
            inputs[index - 1].focus();
        }
    }

    private getPreviousInput(): HTMLInputElement | null {
        const input = this.elementRef.nativeElement;
        const container = input.closest('.letter-container');
        if (!container) return null;

        const inputs = Array.from(
            container.querySelectorAll<HTMLInputElement>('input.letter')
        ).filter((el) => !el.disabled);

        const index = inputs.indexOf(input);
        return index > 0 ? inputs[index - 1] : null;
    }
}