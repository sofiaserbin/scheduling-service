import db from '../../db.js';
import bcrypt from 'bcrypt';
const PW_SALT_ROUNDS = process.env.PW_SALT_ROUNDS || 10;
import jwt from "jsonwebtoken"

export const updateUser = (payload) => {
    payload = JSON.parse(payload);
    console.log('Received payload:', payload);

    const userId = parseInt(payload.userId);
    const requestBody = payload.requestBody;

    if (isNaN(userId)) {
        return JSON.stringify({ httpStatus: 400, message: 'Invalid payload. User ID is not a valid number.' });
    }

    try {
        const currentUser = db.querySync('SELECT * FROM public.user WHERE id = $1', [userId]);
        if (currentUser.length === 0) {
            return JSON.stringify({ httpStatus: 404, message: `User with ID ${userId} not found.` });
        }

        // Construct the update query based on the fields to be updated
        const updateFields = [];
        const updateValues = [];

        let paramCounter = 1;
        if (requestBody.username) {
            updateFields.push(`username = $${paramCounter++}`);
            updateValues.push(requestBody.username);
        }

        if (requestBody.name) {
            updateFields.push(`name = $${paramCounter++}`);
            updateValues.push(requestBody.name);
        }

        if (requestBody.password) {
            updateFields.push(`pw_hash = $${paramCounter++}`);
            const passwordHash = bcrypt.hashSync(requestBody.password, PW_SALT_ROUNDS)
            updateValues.push(passwordHash);
        }

        // Update only if there are fields to update
        if (updateFields.length > 0) {
            const updateQuery = `UPDATE public.user SET ${updateFields.join(', ')} WHERE id = $${paramCounter++} RETURNING *`;

            const result = db.querySync(
                updateQuery,
                [...updateValues, userId]
            );

            const updatedUser = result.length > 0 ? result[0] : null;

            if (!updatedUser) {
                return JSON.stringify({ httpStatus: 500, message: 'Failed to retrieve updated user.' });
            }

            console.log('User details updated for user:', updatedUser);
            console.log('Sending response...');
            return JSON.stringify({ httpStatus: 200, message: `User details for user with ID ${userId} updated successfully.`, user: updatedUser });
        } else {
            // No fields to update
            return JSON.stringify({ httpStatus: 400, message: 'No fields provided for update.' });
        }
    } catch (error) {
        console.error('Error updating user details by ID:', error);
        return JSON.stringify({ httpStatus: 500, message: 'Internal Server Error' });
    }
};


export const readUserId = (payload) => {

    payload = JSON.parse(payload);
    console.log('Received payload:', payload)

    if (!payload)
        return JSON.stringify({ httpStatus: 404, message: 'User ID not found.' })

    try {
        const user = db.querySync(`
            SELECT
                u.id,
                u.name,
                u.username,
                u.clinic_id,
                u.role,
                ROUND(AVG(pod.rating)) AS average_rating
            FROM public.user u
            LEFT JOIN public.patient_on_dentist pod ON u.id = pod.dentist_id
            WHERE u.id = $1
            GROUP BY u.id, pod.dentist_id
        `, [payload])

        if (user.length == 0)
            return JSON.stringify({ httpStatus: 404, message: 'User not found.' })

        return JSON.stringify({ httpStatus: 201, message: user })
    } catch (e) {
        return JSON.stringify({ httpStatus: 500, message: 'Internal Server Error' })
    }
};


export const readUserNotifications = (payload) => {
    payload = JSON.parse(payload);
    const token = jwt.decode(payload.token)

    if (!token) {
        return JSON.stringify({ httpStatus: 401, message: 'Unauthorized' })
    }

    if (`${token.id}` !== `${payload.userId}`) {
        return JSON.stringify({ httpStatus: 403, message: "You may not access other users' notifications" })
    }

    const user = db.querySync('SELECT * FROM public.user WHERE id = $1', [payload.userId])
    if (user.length === 0)
        return JSON.stringify({ httpStatus: 404, message: 'User not found.' })


    let query = 'SELECT * FROM public.notification where user_id = $1 order by id desc';
    let params = [payload.userId];
    if (payload.limit) {
        query += ' limit $2';
        params.push(payload.limit);
    }
    try {
        const notifications = db.querySync(query, params)

        return JSON.stringify({ httpStatus: 200, notifications })
    } catch (e) {
        return JSON.stringify({ httpStatus: 500, message: 'Internal Server Error' })
    }
};

export const markUserNotificationsAsRead = (payload) => {
    payload = JSON.parse(payload);
    const token = jwt.decode(payload.token)

    if (!token) {
        return JSON.stringify({ httpStatus: 401, message: 'Unauthorized' })
    }

    if (`${token.id}` !== `${payload.userId}`) {
        return JSON.stringify({ httpStatus: 403, message: "You may not access other users' notifications" })
    }

    const user = db.querySync('SELECT * FROM public.user WHERE id = $1', [payload.userId])
    if (user.length === 0)
        return JSON.stringify({ httpStatus: 404, message: 'User not found.' })

    try {
        db.querySync('UPDATE public.notification SET read = true WHERE user_id = $1', [payload.userId])
        return JSON.stringify({ httpStatus: 200, message: 'Notifications marked as read' })
    } catch {
        return JSON.stringify({ httpStatus: 500, message: 'Internal Server Error' })
    }

}

export const readUserAppointments = (payload) => {

    payload = JSON.parse(payload);
    console.log('Received payload:', payload);

    if (!payload)
        return JSON.stringify({ httpStatus: 404, message: 'User ID not found.' })

    const user = db.querySync('SELECT * FROM public.user WHERE id = $1', [payload.user_id])
    if (user.length == 0)
        return JSON.stringify({ httpStatus: 404, message: 'User not found.' })


    try {
        if (payload.timespan === 'past') {
            const appointments = db.querySync(
                `SELECT public.appointment.*, public.user.name as dentist_name, public.clinic.name as clinic_name, public.timeslot.start_time, public.timeslot.end_time
                FROM public.appointment
                INNER JOIN public.timeslot ON public.appointment.timeslot_id = public.timeslot.id
                inner join public.user on public.user.id = public.appointment.dentist_id
                left join public.clinic on public.user.clinic_id = public.clinic.id
                WHERE (public.appointment.patient_id = $1 OR public.appointment.dentist_id = $1)
                AND public.timeslot.start_time <= $2
                and public.appointment.cancelled = false`,
                [payload.user_id, new Date().toISOString()]
            );
            return JSON.stringify({ httpStatus: 200, appointments });
        }

        if (payload.timespan === 'upcoming') {
            const appointments = db.querySync(
                `SELECT public.appointment.*, public.user.name as dentist_name, public.clinic.name as clinic_name, public.timeslot.start_time, public.timeslot.end_time
                FROM public.appointment
                INNER JOIN public.timeslot ON public.appointment.timeslot_id = public.timeslot.id
                inner join public.user on public.user.id = public.appointment.dentist_id
                left join public.clinic on public.user.clinic_id = public.clinic.id
                WHERE (public.appointment.patient_id = $1 OR public.appointment.dentist_id = $1)
                AND public.timeslot.start_time >= $2
                and public.appointment.cancelled = false`,
                [payload.user_id, new Date().toISOString()]
            );
            return JSON.stringify({ httpStatus: 200, appointments });
        }


        const appointments = db.querySync(
            `SELECT public.appointment.*, public.user.name as dentist_name, public.clinic.name as clinic_name, public.timeslot.start_time, public.timeslot.end_time
            FROM public.appointment
            INNER JOIN public.timeslot ON public.appointment.timeslot_id = public.timeslot.id
            inner join public.user on public.user.id = public.appointment.dentist_id
            left join public.clinic on public.user.clinic_id = public.clinic.id
            WHERE (public.appointment.patient_id = $1 OR public.appointment.dentist_id = $1)
            and public.appointment.cancelled = false`,
            [payload.user_id]
        );
        return JSON.stringify({ httpStatus: 200, appointments });
    } catch (e) {
        console.log(e)
        return JSON.stringify({ httpStatus: 500, message: 'Internal Server Error' });
    }
}        