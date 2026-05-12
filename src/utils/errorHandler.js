import Swal from 'sweetalert2';

export function globalErrorHandler(err, componentName, info) {
    // 1. Log to Console
    console.group("🔥 Global Error Handler");
    console.error("Error:", err);
    console.error("Context:", info);
    console.error("Component:", componentName);
    console.groupEnd();

    // 2. Extract Message
    const message = err.message || "An unexpected error occurred.";

    // 3. User Notification (Swal Toast)
    Swal.fire({
        icon: 'error',
        title: 'Error Occurred',
        text: message,
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 4000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
        }
    });

    // Optional: Send to logging service (Sentry, Firebase, etc.)
}
