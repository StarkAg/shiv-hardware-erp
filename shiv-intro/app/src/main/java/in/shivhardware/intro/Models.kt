package `in`.shivhardware.intro

import kotlinx.serialization.Serializable

/** One row of shivIntro:waiting. */
@Serializable
data class Waiting(val id: String, val name: String, val phone: String)

/** What devices:trust answers. */
@Serializable
data class TrustAnswer(val ok: Boolean, val token: String? = null, val error: String? = null)
