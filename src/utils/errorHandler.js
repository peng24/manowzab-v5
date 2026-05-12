import Swal from 'sweetalert2';
import { logger } from './logger';

export function globalErrorHandler(err, componentName, info) {
    // 1. Centralized Log
    logger.error(err, { componentName, info });

    // 2. User Feedback (Toast)
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 5000,
        timerProgressBar: true,
    });

    Toast.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาดบางอย่าง',
        text: err.message || 'กรุณาลองใหม่อีกครั้ง',
    });
}
