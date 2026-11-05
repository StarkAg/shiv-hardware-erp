package `in`.shivhardware.intro

import android.content.ContentProviderOperation
import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName

/** The phone's own contacts: looked up and written directly, with no account. */
object PhoneBook {

    sealed interface Result {
        data object Saved : Result
        data class Already(val name: String) : Result
    }

    /**
     * Saves a contact unless the phone already has the number. That check is what
     * makes a repeat harmless: a crash after saving and before answering the
     * server only means the next try finds it and says so. A name already on the
     * phone is never overwritten.
     */
    fun save(context: Context, name: String, mobile: String): Result {
        val number = "+91$mobile"
        existingName(context, number)?.let { return Result.Already(it) }
        val ops = arrayListOf(
            // No account name or type: the contact lives on this device alone.
            ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                .build(),
            ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                .withValue(StructuredName.DISPLAY_NAME, name)
                .build(),
            ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                .withValue(Phone.NUMBER, number)
                .withValue(Phone.TYPE, Phone.TYPE_MOBILE)
                .build(),
        )
        context.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
        return Result.Saved
    }

    /** The name saved against this number, whichever way it was written. */
    private fun existingName(context: Context, number: String): String? {
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
            ?.use { row -> if (row.moveToFirst()) return row.getString(0) ?: "" }
        return null
    }
}
